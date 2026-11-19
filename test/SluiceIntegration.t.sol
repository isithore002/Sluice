// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Vm.sol";
import {FeeMode, CallbackResult} from "reactive-test-lib/ReactiveTest.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {Id} from "morpho-blue/interfaces/IMorpho.sol";
import {SluiceVault} from "../src/SluiceVault.sol";
import {RelayerReserve} from "../src/RelayerReserve.sol";
import {SiblingVault} from "../src/SiblingVault.sol";
import {SluiceReactive} from "../src/SluiceReactive.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";
import {OneClickRepay} from "../src/demo/OneClickRepay.sol";
import {SluiceTestBase} from "./helpers/SluiceTestBase.sol";

/// @notice End to end: real Morpho Blue bytecode, every Sluice contract, three logical chains, and the real Omni
///         system contract and callback proxies from reactive-test-lib.
contract SluiceIntegrationTest is SluiceTestBase {
    SluiceVault internal vault;
    RelayerReserve internal reserve;
    SiblingVault internal sibling;
    SluiceReactive internal rc;
    MockUSD internal uniUsd;
    address internal baseProxyAddr;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");
    address internal lp = makeAddr("unichainLp");

    uint256 internal constant SAFETY_BUFFER = 200e6;

    function setUp() public {
        _reactiveSetUp(LASNA);
        address baseProxy = _registerChain(BASE);
        baseProxyAddr = baseProxy;
        address uniProxy = _registerChain(UNI);

        _switchToChain(BASE);
        _setUpMorphoMarket();

        // Docs' deployment order: reactive first, then callback contracts naming it, then configure.
        rc = new SluiceReactive(BASE, UNI);
        vault = new SluiceVault(IPayable(payable(baseProxy)), address(rc), morpho, params, address(this));
        reserve = new RelayerReserve(IPayable(payable(baseProxy)), address(rc), usd, vault, relayer);
        vault.setReserve(address(reserve));

        _switchToChain(UNI);
        uniUsd = new MockUSD();
        sibling =
            new SiblingVault(IPayable(payable(uniProxy)), address(rc), uniUsd, relayer, SAFETY_BUFFER, address(this));

        _registerContract(LASNA, address(rc));
        _registerContract(BASE, MORPHO_ADDR);
        _registerContract(BASE, address(vault));
        _registerContract(BASE, address(reserve));
        _registerContract(UNI, address(sibling));

        rc.configure(address(vault), address(reserve), address(sibling), MORPHO_ADDR, Id.unwrap(marketId));

        // Lenders: Alice and Bob deposit into the vault; everything is supplied to Morpho.
        _switchToChain(BASE);
        _deposit(alice, 1_000e6);
        _deposit(bob, 1_000e6);
        _settle();
    }

    function _deposit(address who_, uint256 assets_) internal {
        usd.mint(who_, assets_);
        vm.startPrank(who_);
        usd.approve(address(vault), assets_);
        vault.deposit(assets_);
        vm.stopPrank();
    }

    function _request(address who_, uint256 assets_) internal {
        _switchToChain(BASE);
        vm.prank(who_);
        vault.requestWithdraw(assets_);
    }

    function _settle() internal returns (CallbackResult[] memory r_) {
        _switchToChain(LASNA);
        r_ = _reactUntilQuiescent(FeeMode.Subsidized, 20);
        for (uint256 i; i < r_.length; ++i) {
            assertTrue(r_[i].success, "every callback succeeded");
        }
    }

    function _fundCrossChain(uint256 inventory_, uint256 siblingDeposit_) internal {
        _switchToChain(BASE);
        usd.mint(relayer, inventory_);
        vm.startPrank(relayer);
        usd.approve(address(reserve), inventory_);
        reserve.fund(inventory_);
        vm.stopPrank();

        _switchToChain(UNI);
        uniUsd.mint(lp, siblingDeposit_);
        vm.startPrank(lp);
        uniUsd.approve(address(sibling), siblingDeposit_);
        sibling.deposit(siblingDeposit_);
        vm.stopPrank();
        sibling.commitCredit();
        _settle();
    }

    // ----- Flow B: a Morpho repayment settles the queue ------------------------------------------------------

    function test_flowB_morphoRepay_settlesQueue_throughReactive() public {
        _switchToChain(BASE);
        _borrowAll();
        _request(alice, 400e6);
        _request(bob, 300e6);
        _settle();
        assertEq(vault.pendingTotal(), 700e6, "both queued; no cross-chain funds configured");

        _switchToChain(BASE);
        _repay(500e6); // a third party's repayment in a market Sluice doesn't control
        CallbackResult[] memory r = _settle();

        assertGt(r.length, 0, "Reactive sent a callback");
        assertEq(usd.balanceOf(alice), 400e6, "head paid in full");
        assertEq(usd.balanceOf(bob), 100e6, "next partially");
        assertEq(vault.pendingTotal(), 200e6);
        assertFalse(rc.pullPending(), "pull confirmed");
        assertFalse(rc.cron10On(), "no idle Cron billing");
    }

    // ----- Flow C: cross-chain front, then exact reimbursement ------------------------------------------------

    function test_flowC_shortfall_frontedOnBase_reimbursedOnUnichain() public {
        _fundCrossChain(1_000e6, 1_000e6); // credit = 1000 - 200 buffer = 800
        assertEq(rc.credit(), 800e6);
        assertEq(rc.inventory(), 1_000e6);

        _switchToChain(BASE);
        _borrowAll();
        _request(alice, 400e6);
        _settle();

        assertEq(usd.balanceOf(alice), 400e6, "Alice paid from the Base reserve");
        assertEq(vault.pendingTotal(), 0);
        assertEq(uniUsd.balanceOf(relayer), 400e6, "relayer reimbursed on Unichain, exactly what it sent");
        assertEq(sibling.creditAvailable(), 400e6);
        assertEq(rc.openFills().length, 0, "fill closed");
        (,, SluiceReactive.Stage stage,,,) = rc.fills(1);
        assertEq(uint8(stage), uint8(SluiceReactive.Stage.DONE));
        assertEq(rc.fillNonce(), 1, "one shortfall, one fill");
    }

    function test_flowC_creditLimitsFront_rest_waitsForMorpho() public {
        _fundCrossChain(1_000e6, 500e6); // credit = 300
        _switchToChain(BASE);
        _borrowAll();
        _request(alice, 500e6);
        _settle();

        assertEq(usd.balanceOf(alice), 300e6, "fronted up to the committed credit");
        assertEq(vault.pendingTotal(), 200e6);
        assertEq(sibling.creditAvailable(), 0);
        assertEq(uniUsd.balanceOf(lp), 0);
        assertEq(uniUsd.balanceOf(address(sibling)), SAFETY_BUFFER, "safety buffer never leaves Unichain");

        _switchToChain(BASE);
        _repay(200e6);
        _settle();
        assertEq(usd.balanceOf(alice), 500e6, "the rest arrives from Morpho");
        assertEq(vault.pendingTotal(), 0);
    }

    function test_flowA_depositSettlesQueue_withoutReactive() public {
        _switchToChain(BASE);
        _borrowAll();
        _request(alice, 300e6);
        _settle();
        _deposit(makeAddr("carol"), 300e6);
        assertEq(usd.balanceOf(alice), 300e6, "paid in the deposit's own transaction");
    }

    // ----- Batches: one repayment, more queued withdrawals than a single callback may pay ----------------------

    bytes32 internal constant SETTLED_T0 = keccak256("WithdrawSettled(uint256,address,uint256,uint256,uint256)");
    bytes32 internal constant STATE_T0 = keccak256("StateUpdated(uint256,uint256,uint256)");

    /// @dev `n_` lenders each deposit `each_`, the market is then drained to 100% utilization, and every lender
    ///      queues a full withdrawal: `n_` queued requests (ids 0..n_-1) with nothing reachable.
    function _queueMany(uint256 n_, uint256 each_) internal returns (address[] memory owners_) {
        owners_ = new address[](n_);
        _switchToChain(BASE);
        for (uint256 i; i < n_; ++i) {
            owners_[i] = makeAddr(string.concat("lender", vm.toString(i)));
            _deposit(owners_[i], each_);
        }
        _borrowAll();
        for (uint256 i; i < n_; ++i) {
            vm.prank(owners_[i]);
            vault.requestWithdraw(each_);
        }
        assertEq(vault.queueLength(), n_);
        assertEq(vault.pendingTotal(), n_ * each_);
        _settle(); // Reactive sees the queue grow; nothing is reachable, so it does nothing
        assertFalse(rc.pullPending());
    }

    function _pullCallbacks(CallbackResult[] memory r_) internal view returns (uint256 n_) {
        for (uint256 i; i < r_.length; ++i) {
            if (r_[i].recipient == address(vault) && bytes4(r_[i].payload) == SluiceVault.pullFromMorpho.selector) {
                n_++;
            }
        }
    }

    /// @dev Request ids of every WithdrawSettled in capture order, and how many had been emitted at each StateUpdated.
    function _settledIdsAndBatches()
        internal
        view
        returns (uint256[] memory ids_, uint256[] memory settledAtEachState_)
    {
        Vm.Log[] memory logs = _recordedLogs();
        uint256 nSettled;
        uint256 nState;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == SETTLED_T0) nSettled++;
            else if (logs[i].topics[0] == STATE_T0) nState++;
        }
        ids_ = new uint256[](nSettled);
        settledAtEachState_ = new uint256[](nState);
        uint256 a;
        uint256 b;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == SETTLED_T0) ids_[a++] = uint256(logs[i].topics[1]);
            else if (logs[i].topics[0] == STATE_T0) settledAtEachState_[b++] = a;
        }
    }

    function test_batch_fortyQueued_oneRepay_paidFifo_acrossTwoCallbacks() public {
        address[] memory owners = _queueMany(40, 10e6);

        _switchToChain(BASE);
        _repay(400e6); // ONE repayment frees cash for all forty
        CallbackResult[] memory r = _settle();

        // Two bounded callbacks, no deposit and no manual call in between: 25, then the remaining 15.
        assertEq(_pullCallbacks(r), 2, "exactly two pull callbacks");
        assertEq(vault.pendingTotal(), 0, "queue empty");
        assertEq(vault.head(), 40, "head advanced past everyone");
        assertFalse(rc.pullPending(), "last pull confirmed");
        assertFalse(rc.cron10On(), "no idle Cron billing");
        for (uint256 i; i < 40; ++i) {
            assertEq(usd.balanceOf(owners[i]), 10e6, "every lender paid in full");
        }

        // FIFO: request ids were paid strictly in order 0..39, and no callback paid more than the cap.
        (uint256[] memory ids, uint256[] memory settledAtState) = _settledIdsAndBatches();
        assertEq(ids.length, 40, "forty payments");
        for (uint256 i; i < ids.length; ++i) {
            assertEq(ids[i], i, "paid in queue order");
        }
        uint256 maxBatch;
        uint256 prev;
        for (uint256 i; i < settledAtState.length; ++i) {
            uint256 batch = settledAtState[i] - prev;
            if (batch > maxBatch) maxBatch = batch;
            prev = settledAtState[i];
        }
        assertEq(prev, 40, "the last StateUpdated saw all forty paid");
        assertEq(maxBatch, vault.MAX_FILLS_PER_CALL(), "no callback paid more than the cap");
    }

    function test_batch_eightyQueued_oneRepay_fourBoundedCallbacks() public {
        address[] memory owners = _queueMany(80, 5e6);

        _switchToChain(BASE);
        _repay(400e6);
        CallbackResult[] memory r = _settle();

        assertEq(_pullCallbacks(r), 4, "25 + 25 + 25 + 5");
        assertEq(vault.pendingTotal(), 0);
        for (uint256 i; i < 80; ++i) {
            assertEq(usd.balanceOf(owners[i]), 5e6);
        }
        (uint256[] memory ids,) = _settledIdsAndBatches();
        for (uint256 i; i < ids.length; ++i) {
            assertEq(ids[i], i, "FIFO across all four batches");
        }
    }

    function test_batch_cashForThirty_ofForty_stopsAtThirty_andDoesNotLoop() public {
        address[] memory owners = _queueMany(40, 10e6);

        _switchToChain(BASE);
        _repay(300e6); // enough for 30 of the 40
        CallbackResult[] memory r = _settle();

        assertEq(_pullCallbacks(r), 2, "25 then 5, then it stops: nothing more is reachable");
        assertEq(vault.head(), 30);
        assertEq(vault.pendingTotal(), 100e6, "ten still waiting");
        assertFalse(rc.pullPending(), "no pull left in flight");
        assertFalse(rc.cron10On(), "and no retry timer");
        for (uint256 i; i < 40; ++i) {
            assertEq(usd.balanceOf(owners[i]), i < 30 ? 10e6 : 0, "first thirty paid, last ten still queued");
        }

        // The next repayment finishes the job with a fresh Morpho event, not a manual call.
        _switchToChain(BASE);
        _repay(100e6);
        _settle();
        assertEq(vault.pendingTotal(), 0);
        assertEq(vault.head(), 40);
    }

    /// @dev Worst case for gas: a full batch of 25 payments to 25 distinct, never-before-seen recipients, with every
    ///      account and storage slot cold. It must fit the callback's gas limit with a wide margin.
    function test_batch_fullBatchGas_fitsInsideTheCallbackGasLimit() public {
        address[] memory owners = _queueMany(25, 10e6);
        _switchToChain(BASE);
        _repay(250e6);

        vm.cool(address(usd));
        vm.cool(address(vault));
        vm.cool(MORPHO_ADDR);
        for (uint256 i; i < owners.length; ++i) {
            vm.cool(owners[i]);
        }

        vm.prank(baseProxyAddr);
        vault.pullFromMorpho(address(rc), 1);
        // Decoded by hand: the pinned forge-std declares a newer `Vm.Gas` struct than Foundry 1.5.1 returns.
        (bool ok, bytes memory gasData) = address(vm).staticcall(abi.encodeWithSignature("lastCallGas()"));
        assertTrue(ok, "lastCallGas");
        (, uint256 used) = abi.decode(gasData, (uint256, uint256)); // (gasLimit, gasTotalUsed, ...)

        emit log_named_uint("gas used by a 25-payment pullFromMorpho (cold)", used);
        assertEq(vault.head(), 25, "all twenty-five paid in one call");
        // PULL_GAS is 1.5M and the proxy keeps some back, so require a comfortable 25% margin below it.
        assertLt(used, (uint256(rc.PULL_GAS()) * 75) / 100, "fits the gas limit with margin");
    }

    // ----- One-click repay: a visitor's single transaction triggers a real settlement --------------------------

    function test_oneClickRepay_anyVisitor_triggersTheSettlement() public {
        _switchToChain(BASE);
        _borrowAll();
        _request(alice, 10e6);
        _request(bob, 10e6);
        _settle();
        assertEq(vault.pendingTotal(), 20e6, "two demo withdrawals queued");

        _switchToChain(BASE);
        OneClickRepay one = new OneClickRepay(morpho, params, borrower, 10e6);
        address visitor = makeAddr("visitor"); // holds nothing: the helper mints what it repays
        vm.prank(visitor);
        one.settle();
        CallbackResult[] memory r = _settle();

        assertEq(_pullCallbacks(r), 1, "Reactive pulled once");
        assertEq(usd.balanceOf(alice), 10e6, "the head of the queue is paid");
        assertEq(usd.balanceOf(bob), 0, "the next one keeps waiting for the next click");
        assertEq(vault.pendingTotal(), 10e6);
        assertEq(usd.balanceOf(visitor), 0, "the visitor spends only gas");
    }
}
