// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {FeeMode, CallbackResult} from "reactive-test-lib/ReactiveTest.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {Id} from "morpho-blue/interfaces/IMorpho.sol";
import {SluiceVault} from "../src/SluiceVault.sol";
import {RelayerReserve} from "../src/RelayerReserve.sol";
import {SiblingVault} from "../src/SiblingVault.sol";
import {SluiceReactive} from "../src/SluiceReactive.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";
import {SluiceTestBase} from "./helpers/SluiceTestBase.sol";

/// @notice End to end: real Morpho Blue bytecode, every Sluice contract, three logical chains, and the real Omni
///         system contract and callback proxies from reactive-test-lib.
contract SluiceIntegrationTest is SluiceTestBase {
    SluiceVault internal vault;
    RelayerReserve internal reserve;
    SiblingVault internal sibling;
    SluiceReactive internal rc;
    MockUSD internal uniUsd;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");
    address internal lp = makeAddr("unichainLp");

    uint256 internal constant SAFETY_BUFFER = 200e6;

    function setUp() public {
        _reactiveSetUp(LASNA);
        address baseProxy = _registerChain(BASE);
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
}
