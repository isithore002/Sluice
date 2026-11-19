// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {SluiceVault} from "../src/SluiceVault.sol";
import {ISluiceVault} from "../src/interfaces/ISluiceVault.sol";
import {SluiceTestBase} from "./helpers/SluiceTestBase.sol";

contract SluiceVaultTest is SluiceTestBase {
    SluiceVault internal vault;

    address internal proxy = makeAddr("callbackProxy");
    address internal rvm = makeAddr("sluiceReactive");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        _setUpMorphoMarket();
        vault = new SluiceVault(IPayable(payable(proxy)), rvm, morpho, params, address(this));
        _deposit(alice, 1_000e6);
        _deposit(bob, 1_000e6);
        _deposit(carol, 1_000e6);
    }

    // ----- helpers -------------------------------------------------------------------------------------------

    function _deposit(address who_, uint256 assets_) internal {
        usd.mint(who_, assets_);
        vm.startPrank(who_);
        usd.approve(address(vault), assets_);
        vault.deposit(assets_);
        vm.stopPrank();
    }

    function _request(address who_, uint256 assets_) internal returns (bool queued_, uint256 id_) {
        vm.prank(who_);
        return vault.requestWithdraw(assets_);
    }

    function _pull(uint256 trace_) internal {
        vm.prank(proxy);
        vault.pullFromMorpho(rvm, trace_);
    }

    // ----- deposits and instant withdrawals ------------------------------------------------------------------

    function test_deposit_isSuppliedToMorpho() public view {
        assertEq(vault.idle(), 0, "nothing idle");
        assertEq(vault.morphoSupplied(), 3_000e6, "all supplied");
    }

    function test_withdraw_paidInstantly_whenLiquid() public {
        (bool queued,) = _request(alice, 400e6);
        assertFalse(queued);
        assertEq(usd.balanceOf(alice), 400e6);
        assertEq(vault.pendingTotal(), 0);
    }

    // ----- queueing ------------------------------------------------------------------------------------------

    function test_withdraw_queues_whenIlliquid() public {
        _borrowAll();
        vm.expectEmit(address(vault));
        emit ISluiceVault.WithdrawQueued(0, alice, 400e6);
        vm.expectEmit(address(vault));
        emit ISluiceVault.StateUpdated(400e6, 400e6, 0);
        (bool queued, uint256 id) = _request(alice, 400e6);
        assertTrue(queued);
        assertEq(id, 0);
        assertEq(vault.pendingTotal(), 400e6);
        assertEq(vault.shortfall(), 400e6);
    }

    function test_withdraw_partiallyPaidAtOnce_whenSomeLiquidity() public {
        _borrowAll();
        _repay(100e6); // 100 free in Morpho before Alice asks
        (bool queued,) = _request(alice, 400e6);
        assertTrue(queued, "not enough for instant");
        assertEq(usd.balanceOf(alice), 100e6, "vault pulled what it could reach itself");
        assertEq(vault.pendingTotal(), 300e6);
        assertEq(vault.shortfall(), 300e6);
    }

    // ----- the Reactive callback -----------------------------------------------------------------------------

    function test_pull_afterRepay_paysFifoWithPartialFill() public {
        _borrowAll();
        _request(alice, 300e6);
        _request(bob, 300e6);
        _repay(400e6);

        vm.expectEmit(address(vault));
        emit ISluiceVault.WithdrawSettled(0, alice, 300e6, 0, 0xabc);
        vm.expectEmit(address(vault));
        emit ISluiceVault.WithdrawSettled(1, bob, 100e6, 200e6, 0xabc);
        vm.expectEmit(address(vault));
        emit ISluiceVault.StateUpdated(200e6, 200e6, 0xabc);
        _pull(0xabc);

        assertEq(usd.balanceOf(alice), 300e6, "head paid in full first");
        assertEq(usd.balanceOf(bob), 100e6, "next one partially");
        (, uint256 bobRemaining) = vault.request(1);
        assertEq(bobRemaining, 200e6);
        assertEq(vault.head(), 1, "head stays on the partial request");
    }

    function test_pull_noLiquidity_doesNotRevert_andStillEmitsState() public {
        _borrowAll();
        _request(alice, 300e6);
        vm.expectEmit(address(vault));
        emit ISluiceVault.StateUpdated(300e6, 300e6, 7);
        _pull(7);
        assertEq(vault.pendingTotal(), 300e6);
    }

    function test_pull_rejectsNonProxyCaller() public {
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), proxy));
        vault.pullFromMorpho(rvm, 1);
    }

    function test_pull_rejectsWrongReactiveSender() public {
        address impostor = makeAddr("impostor");
        vm.prank(proxy);
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, impostor, rvm));
        vault.pullFromMorpho(impostor, 1);
    }

    // ----- fairness ------------------------------------------------------------------------------------------

    function test_reservation_laterRequestQueuesBehind_evenWithLiquidity() public {
        _borrowAll();
        _request(alice, 300e6);
        _repay(500e6); // liquidity appears in Morpho; Reactive hasn't pulled yet

        (bool queued,) = _request(bob, 100e6);
        assertTrue(queued, "Bob can't skip the queue");
        // Bob's request made the vault pull what it can reach: Alice is paid first, then Bob.
        assertEq(usd.balanceOf(alice), 300e6);
        assertEq(usd.balanceOf(bob), 100e6);
        assertEq(vault.pendingTotal(), 0);
    }

    function test_reservation_queueBlocksInstantPath() public {
        _borrowAll();
        _request(alice, 300e6);
        // Someone donates idle assets directly to the vault: they must go to the queue, not to a newcomer.
        usd.mint(address(vault), 50e6);
        (bool queued,) = _request(bob, 50e6);
        assertTrue(queued);
        assertEq(usd.balanceOf(alice), 50e6, "idle went to the head of the queue");
        assertEq(usd.balanceOf(bob), 0);
    }

    function test_deposit_settlesQueueInSameTransaction() public {
        _borrowAll();
        _request(alice, 300e6);
        _deposit(makeAddr("dave"), 200e6);
        assertEq(usd.balanceOf(alice), 200e6, "deposit paid the queue synchronously");
        assertEq(vault.pendingTotal(), 100e6);
        assertEq(vault.idle(), 0, "nothing allocated while people wait");
    }

    // ----- reserve hook --------------------------------------------------------------------------------------

    function test_onFronted_onlyReserve() public {
        vm.expectRevert(ISluiceVault.NotReserve.selector);
        vault.onFronted(1, 1, 1);
    }

    function test_onFronted_settlesQueueWithFrontedAssets() public {
        address reserveAddr = makeAddr("reserve");
        vault.setReserve(reserveAddr);
        _borrowAll();
        _request(alice, 300e6);
        usd.mint(address(vault), 300e6); // the reserve's transfer
        vm.expectEmit(address(vault));
        emit ISluiceVault.WithdrawSettled(0, alice, 300e6, 0, 99);
        vm.prank(reserveAddr);
        vault.onFronted(1, 300e6, 99);
        assertEq(vault.pendingTotal(), 0);
    }

    function test_setReserve_onlyOnce() public {
        vault.setReserve(makeAddr("r1"));
        vm.expectRevert(ISluiceVault.ReserveAlreadySet.selector);
        vault.setReserve(makeAddr("r2"));
    }

    // ----- gas bound -----------------------------------------------------------------------------------------

    function test_pull_gasBounded_with100DistinctQueuedUsers() public {
        address[] memory users = new address[](100);
        for (uint256 i; i < 100; ++i) {
            users[i] = vm.addr(i + 1000);
            _deposit(users[i], 1e6);
        }
        _borrowAll();
        for (uint256 i; i < 100; ++i) {
            _request(users[i], 1e6);
        }
        _repay(100e6);

        vm.prank(proxy);
        uint256 before = gasleft();
        vault.pullFromMorpho(rvm, 1);
        uint256 used = before - gasleft();
        emit log_named_uint("pullFromMorpho gas (25 fills, distinct recipients)", used);

        assertEq(vault.head(), 25, "capped at 25 payments per call");
        // Callback gas limit is 1.5M and the proxy keeps some for itself; stay well under.
        assertLt(used, 1_200_000, "fits the callback gas limit with margin");
    }

    // ----- conservation and FIFO under random sequences ------------------------------------------------------

    function testFuzz_conservationAndFifo(uint256 seed_) public {
        _borrowAll();
        uint256 queued;
        uint256 paidBefore = usd.balanceOf(alice) + usd.balanceOf(bob) + usd.balanceOf(carol);
        address[3] memory who = [alice, bob, carol];

        for (uint256 step; step < 12; ++step) {
            uint256 r = uint256(keccak256(abi.encode(seed_, step)));
            address u = who[r % 3];
            if (r % 2 == 0 && vault.sharesOf(u) > 0) {
                uint256 amt = bound(r >> 8, 1, vault.sharesOf(u) > 200e6 ? 200e6 : vault.sharesOf(u));
                (bool q,) = _request(u, amt);
                if (q) queued += amt;
                else paidBefore += amt; // instant payments count as already paid
            } else {
                uint256 liq = morpho.market(marketId).totalBorrowAssets;
                if (liq > 0) _repay(bound(r >> 16, 1, liq));
                _pull(step);
            }
            _assertFifo();
        }

        uint256 paidNow = usd.balanceOf(alice) + usd.balanceOf(bob) + usd.balanceOf(carol);
        assertEq(paidNow - paidBefore + vault.pendingTotal(), queued, "paid + pending == queued");
    }

    function _assertFifo() internal view {
        uint256 len = vault.queueLength();
        uint256 h = vault.head();
        for (uint256 i; i < h; ++i) {
            (, uint256 rem) = vault.request(i);
            assertEq(rem, 0, "everything before head is fully paid");
        }
        for (uint256 i = h + 1; i < len; ++i) {
            (, uint256 rem) = vault.request(i);
            assertGt(rem, 0, "nothing after head is touched");
        }
    }
}
