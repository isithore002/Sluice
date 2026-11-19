// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ReactiveTest, FeeMode, CallbackResult} from "reactive-test-lib/ReactiveTest.sol";
import {SluiceReactive} from "../src/SluiceReactive.sol";
import {LogEmitter} from "./helpers/LogEmitter.sol";

/// @notice SluiceReactive driven through the real Omni system contract pipeline (subscription matching, react(),
///         Cron cascade, callback delivery). Origin contracts are LogEmitter stand-ins so each test controls the
///         exact event stream, including dropped, duplicated and reordered confirmations.
contract SluiceReactiveTest is ReactiveTest {
    uint256 internal constant LASNA = 5318007;
    uint256 internal constant BASE = 84532;
    uint256 internal constant UNI = 1301;
    bytes32 internal constant MARKET = keccak256("our market");

    bytes32 internal constant STATE_T0 = keccak256("StateUpdated(uint256,uint256,uint256)");
    bytes32 internal constant REPAY_T0 = keccak256("Repay(bytes32,address,address,uint256,uint256)");
    bytes32 internal constant SUPPLY_T0 = keccak256("Supply(bytes32,address,address,uint256,uint256)");
    bytes32 internal constant LIQUIDATE_T0 =
        keccak256("Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)");
    bytes32 internal constant FRONTED_T0 = keccak256("Fronted(uint256,uint256,uint256,uint256,uint256)");
    bytes32 internal constant INVENTORY_T0 = keccak256("InventoryUpdated(uint256)");
    bytes32 internal constant CREDIT_T0 = keccak256("CreditCommitted(uint256)");
    bytes32 internal constant REIMBURSED_T0 = keccak256("Reimbursed(uint256,uint256,uint256,uint256)");
    bytes32 internal constant REIMBURSE_FAILED_T0 = keccak256("ReimburseFailed(uint256,uint256,uint256)");

    bytes4 internal constant PULL_SEL = bytes4(keccak256("pullFromMorpho(address,uint256)"));
    bytes4 internal constant FRONT_SEL = bytes4(keccak256("front(address,uint256,uint256,uint256)"));
    bytes4 internal constant REIMBURSE_SEL = bytes4(keccak256("reimburse(address,uint256,uint256,uint256)"));

    SluiceReactive internal rc;
    LogEmitter internal vaultE;
    LogEmitter internal morphoE;
    LogEmitter internal reserveE;
    LogEmitter internal siblingE;

    function setUp() public {
        _reactiveSetUp(LASNA);
        _registerChain(BASE);
        _registerChain(UNI);

        vaultE = new LogEmitter();
        morphoE = new LogEmitter();
        reserveE = new LogEmitter();
        siblingE = new LogEmitter();
        _registerContract(BASE, address(vaultE));
        _registerContract(BASE, address(morphoE));
        _registerContract(BASE, address(reserveE));
        _registerContract(UNI, address(siblingE));

        rc = new SluiceReactive(BASE, UNI);
        _registerContract(LASNA, address(rc));
        rc.configure(address(vaultE), address(reserveE), address(siblingE), address(morphoE), MARKET);

        vm.roll(100);
        _run(); // apply the subscriptions
    }

    // ----- event helpers -------------------------------------------------------------------------------------

    function _emit(LogEmitter e_, uint256 chain_, bytes32[] memory topics_, bytes memory data_) internal {
        _switchToChain(chain_);
        e_.emitLog(topics_, data_);
    }

    function _t(bytes32 a_) internal pure returns (bytes32[] memory t_) {
        t_ = new bytes32[](1);
        t_[0] = a_;
    }

    function _t(bytes32 a_, bytes32 b_) internal pure returns (bytes32[] memory t_) {
        t_ = new bytes32[](2);
        t_[0] = a_;
        t_[1] = b_;
    }

    function _t(bytes32 a_, bytes32 b_, bytes32 c_, bytes32 d_) internal pure returns (bytes32[] memory t_) {
        t_ = new bytes32[](4);
        t_[0] = a_;
        t_[1] = b_;
        t_[2] = c_;
        t_[3] = d_;
    }

    function _state(uint256 pending_, uint256 shortfall_, uint256 trace_) internal {
        _emit(vaultE, BASE, _t(STATE_T0), abi.encode(pending_, shortfall_, trace_));
    }

    function _repay(bytes32 market_) internal {
        _emit(morphoE, BASE, _t(REPAY_T0, market_, bytes32(0), bytes32(0)), abi.encode(uint256(1e6), uint256(1)));
    }

    function _supply() internal {
        _emit(morphoE, BASE, _t(SUPPLY_T0, MARKET, bytes32(0), bytes32(0)), abi.encode(uint256(1e6), uint256(1)));
    }

    function _liquidate(uint256 badDebt_) internal {
        _emit(
            morphoE,
            BASE,
            _t(LIQUIDATE_T0, MARKET, bytes32(0), bytes32(0)),
            abi.encode(uint256(1e6), uint256(1), uint256(2e18), badDebt_, uint256(0))
        );
    }

    function _fronted(uint256 fillId_, uint256 requested_, uint256 sent_, uint256 inventory_, uint256 trace_) internal {
        _emit(reserveE, BASE, _t(FRONTED_T0, bytes32(fillId_)), abi.encode(requested_, sent_, inventory_, trace_));
    }

    function _inventory(uint256 inventory_) internal {
        _emit(reserveE, BASE, _t(INVENTORY_T0), abi.encode(inventory_));
    }

    function _credit(uint256 credit_) internal {
        _emit(siblingE, UNI, _t(CREDIT_T0), abi.encode(credit_));
    }

    function _reimbursed(uint256 fillId_, uint256 amount_, uint256 credit_, uint256 trace_) internal {
        _emit(siblingE, UNI, _t(REIMBURSED_T0, bytes32(fillId_)), abi.encode(amount_, credit_, trace_));
    }

    function _reimburseFailed(uint256 fillId_, uint256 amount_, uint256 credit_) internal {
        _emit(siblingE, UNI, _t(REIMBURSE_FAILED_T0, bytes32(fillId_)), abi.encode(amount_, credit_));
    }

    function _cronAt(uint256 block_) internal returns (CallbackResult[] memory) {
        vm.roll(block_);
        _switchToChain(LASNA);
        _emitCron(block_);
        return _run();
    }

    function _run() internal returns (CallbackResult[] memory) {
        _switchToChain(LASNA);
        return _react(FeeMode.Subsidized);
    }

    // ----- result helpers ------------------------------------------------------------------------------------

    function _sel(bytes memory p_) internal pure returns (bytes4 s_) {
        assembly {
            s_ := mload(add(p_, 32))
        }
    }

    function _args(bytes memory p_) internal pure returns (bytes memory a_) {
        a_ = new bytes(p_.length - 4);
        for (uint256 i; i < a_.length; ++i) {
            a_[i] = p_[i + 4];
        }
    }

    function _only(CallbackResult[] memory r_, address to_, bytes4 sel_) internal pure returns (bytes memory) {
        assertEq(r_.length, 1, "exactly one callback");
        assertEq(r_[0].recipient, to_, "recipient");
        assertEq(_sel(r_[0].payload), sel_, "function");
        assertTrue(r_[0].success, "delivered");
        return _args(r_[0].payload);
    }

    function _frontArgs(CallbackResult[] memory r_) internal view returns (uint256 fillId_, uint256 amount_) {
        (address sender, uint256 id, uint256 amt,) =
            abi.decode(_only(r_, address(reserveE), FRONT_SEL), (address, uint256, uint256, uint256));
        assertEq(sender, address(rc), "network injected the reactive address");
        return (id, amt);
    }

    function _reimburseArgs(CallbackResult[] memory r_) internal view returns (uint256 fillId_, uint256 amount_) {
        (, uint256 id, uint256 amt,) =
            abi.decode(_only(r_, address(siblingE), REIMBURSE_SEL), (address, uint256, uint256, uint256));
        return (id, amt);
    }

    function _stage(uint256 fillId_) internal view returns (SluiceReactive.Stage s_) {
        (,, s_,,,) = rc.fills(fillId_);
    }

    // =========================================================================================================
    // Morpho path
    // =========================================================================================================

    function test_repay_withQueue_requestsPull() public {
        _state(400e6, 400e6, 1);
        assertEq(_run().length, 0, "nothing reachable, no credit: wait");

        _repay(MARKET);
        CallbackResult[] memory r = _run();
        (address sender, uint256 trace) = abi.decode(_only(r, address(vaultE), PULL_SEL), (address, uint256));
        assertEq(sender, address(rc));
        assertEq(trace, 0, "trace = origin tx hash (0 in the simulator)");
        assertTrue(rc.pullPending());
        assertTrue(rc.cron10On(), "retry clock on while a pull is in flight");
    }

    function test_supply_withQueue_requestsPull() public {
        _state(400e6, 400e6, 1);
        _run();
        _supply();
        _only(_run(), address(vaultE), PULL_SEL);
    }

    function test_repay_withoutQueue_isIgnored() public {
        _repay(MARKET);
        assertEq(_run().length, 0);
        assertFalse(rc.pullPending());
    }

    function test_repay_inOtherMarket_isIgnored() public {
        _state(400e6, 400e6, 1);
        _run();
        _repay(keccak256("someone else's market"));
        assertEq(_run().length, 0);
    }

    function test_pullConfirmed_withoutProgress_doesNotLoop() public {
        _state(400e6, 400e6, 1);
        _repay(MARKET);
        _run();
        // The pull ran but the queue didn't shrink, although the vault reports reachable liquidity.
        _state(400e6, 300e6, 0);
        assertEq(_run().length, 0, "no progress, no re-pull");
        assertFalse(rc.pullPending());
        assertFalse(rc.cron10On(), "retry clock off when idle");
    }

    function test_pullConfirmed_withProgress_andReachableLeft_pullsAgain() public {
        _state(400e6, 400e6, 1);
        _repay(MARKET);
        _run();
        _state(300e6, 100e6, 0); // progress, and 200 still reachable (e.g. the 25-payment cap)
        _only(_run(), address(vaultE), PULL_SEL);
    }

    function test_repayWhilePullPending_repullsAfterConfirmation() public {
        _state(400e6, 400e6, 1);
        _repay(MARKET);
        _run();
        _repay(MARKET);
        assertEq(_run().length, 0, "one pull in flight at a time");
        assertTrue(rc.repullAfterConfirm());

        _state(300e6, 300e6, 0); // confirmation; nothing reachable at that moment
        _only(_run(), address(vaultE), PULL_SEL);
    }

    // ----- delay mode (latency race) -------------------------------------------------------------------------

    function test_delayMode_waitsDelayBlocks_viaCron1() public {
        rc.setDelayBlocks(6);
        _state(400e6, 400e6, 1);
        _run();

        vm.roll(101);
        _repay(MARKET);
        assertEq(_run().length, 0, "scheduled, not sent");
        assertTrue(rc.pullScheduled());
        assertEq(rc.pullDueBlock(), 107);
        assertTrue(rc.cron1On());

        assertEq(_cronAt(104).length, 0, "not due yet");
        _only(_cronAt(107), address(vaultE), PULL_SEL);
        assertFalse(rc.pullScheduled());
        assertFalse(rc.cron1On(), "Cron1 unsubscribed once done");
    }

    // ----- retries -------------------------------------------------------------------------------------------

    function test_pullRetry_backsOff_thenGivesUp() public {
        _state(400e6, 400e6, 1);
        _repay(MARKET); // pull at block 100
        _run();

        _only(_cronAt(110), address(vaultE), PULL_SEL); // retry 1 (window 10)
        assertEq(_cronAt(120).length, 0, "backoff: next window is 20");
        _only(_cronAt(130), address(vaultE), PULL_SEL); // retry 2
        _only(_cronAt(170), address(vaultE), PULL_SEL); // retry 3 (window 40)
        assertEq(_cronAt(250).length, 0, "gave up after 3 retries"); // window 80 elapsed: give up
        assertFalse(rc.pullPending());
        assertFalse(rc.cron10On(), "retry clock off after giving up");
    }

    // =========================================================================================================
    // Cross-chain path
    // =========================================================================================================

    function _fund(uint256 credit_, uint256 inventory_) internal {
        _credit(credit_);
        _inventory(inventory_);
        _run();
    }

    function test_crossChain_happyPath_frontThenReimburseExactlySent() public {
        _fund(1_000e6, 1_000e6);

        _state(400e6, 400e6, 77);
        (uint256 fillId, uint256 amount) = _frontArgs(_run());
        assertEq(fillId, 1);
        assertEq(amount, 400e6);
        assertEq(uint8(_stage(1)), uint8(SluiceReactive.Stage.FRONTING));

        // Execution on Base: the vault settles first (StateUpdated), then the reserve confirms (Fronted).
        _state(0, 0, 77);
        assertEq(_run().length, 0, "no double front while the fill is in flight");
        _fronted(1, 400e6, 400e6, 600e6, 77);
        (uint256 rid, uint256 ramount) = _reimburseArgs(_run());
        assertEq(rid, 1);
        assertEq(ramount, 400e6, "reimburse exactly what was sent");

        _reimbursed(1, 400e6, 600e6, 77);
        assertEq(_run().length, 0);
        assertEq(uint8(_stage(1)), uint8(SluiceReactive.Stage.DONE));
        assertEq(rc.openFills().length, 0);
        assertFalse(rc.cron10On());
    }

    function test_crossChain_frontIsMinOfShortfallInventoryCredit() public {
        _fund(1_000e6, 300e6);
        _state(400e6, 400e6, 1);
        (, uint256 amount) = _frontArgs(_run());
        assertEq(amount, 300e6, "capped by inventory");
    }

    function test_crossChain_reimbursesSent_notRequested_whenReserveSentLess() public {
        _fund(1_000e6, 1_000e6); // stale inventory cache: the reserve actually holds less
        _state(400e6, 400e6, 1);
        _run();
        _state(150e6, 150e6, 1);
        _fronted(1, 400e6, 250e6, 0, 1);
        (, uint256 ramount) = _reimburseArgs(_run());
        assertEq(ramount, 250e6, "never reimburse more than was sent");
    }

    function test_crossChain_nothingSent_closesFill_noReimburse() public {
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1);
        _run();
        _state(400e6, 400e6, 1); // the vault publishes state even when nothing arrived
        _fronted(1, 400e6, 0, 0, 1);
        CallbackResult[] memory r = _run();
        for (uint256 i; i < r.length; ++i) {
            assertTrue(_sel(r[i].payload) != REIMBURSE_SEL, "nothing to reimburse");
        }
        assertEq(uint8(_stage(1)), uint8(SluiceReactive.Stage.DONE));
    }

    function test_crossChain_newShortfallWhileInFlight_frontsOnlyTheDifference() public {
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1);
        _run();
        _state(600e6, 600e6, 2); // another 200 queued before fill 1 executes
        (uint256 id, uint256 amount) = _frontArgs(_run());
        assertEq(id, 2);
        assertEq(amount, 200e6);
    }

    function test_crossChain_creditReservedForOpenFills() public {
        _fund(500e6, 1_000e6);
        _state(400e6, 400e6, 1);
        _run();
        _state(800e6, 800e6, 2);
        (, uint256 amount) = _frontArgs(_run());
        assertEq(amount, 100e6, "only 100 credit left after reserving 400 for fill 1");
    }

    function test_crossChain_missedFronted_healsViaRetry() public {
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1); // front at block 100
        _run();

        // The Fronted confirmation never arrives: the retry re-sends the same fill (idempotent at the reserve).
        (uint256 id, uint256 amount) = _frontArgs(_cronAt(110));
        assertEq(id, 1);
        assertEq(amount, 400e6);

        // The reserve has the vault publish fresh state, then re-emits its stored result; the fill moves on and
        // the stale 400 shortfall is NOT fronted a second time.
        _state(0, 0, 1);
        _fronted(1, 400e6, 400e6, 600e6, 1);
        (uint256 rid,) = _reimburseArgs(_run());
        assertEq(rid, 1);
        assertEq(rc.fillNonce(), 1, "no second fill");
    }

    function test_crossChain_bothEventsMissed_retryDoesNotDoubleFront() public {
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1);
        _run();
        // The front executed on Base but Lasna missed BOTH of its events (e.g. while in debt).
        // The retry's repeat reaches the reserve, which publishes the vault's current state, then re-confirms.
        _frontArgs(_cronAt(110));
        _state(0, 0, 1);
        _fronted(1, 400e6, 400e6, 600e6, 1);
        _reimburseArgs(_run());
        assertEq(rc.fillNonce(), 1, "exactly one fill for one shortfall");
    }

    function test_crossChain_reimburseFails_givesUp_thenFreshCreditRevivesIt() public {
        _fund(400e6, 1_000e6);
        _state(400e6, 400e6, 1);
        _run();
        _state(0, 0, 1);
        _fronted(1, 400e6, 400e6, 600e6, 1);
        _run(); // reimburse requested at block 100
        _reimburseFailed(1, 400e6, 0); // credit got used elsewhere meanwhile
        _run();

        _reimburseArgs(_cronAt(110));
        _reimburseArgs(_cronAt(130));
        _reimburseArgs(_cronAt(170));
        assertEq(_cronAt(250).length, 0, "gave up after 3 retries");
        assertFalse(rc.cron10On());

        _credit(500e6);
        (uint256 rid, uint256 ramount) = _reimburseArgs(_run());
        assertEq(rid, 1);
        assertEq(ramount, 400e6);
    }

    function test_badDebt_haltsFronting_untilResume_butStillPulls() public {
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1); // fronts fill 1
        _run();
        _state(0, 0, 1);
        _fronted(1, 400e6, 400e6, 600e6, 1);
        _reimbursed(1, 400e6, 600e6, 1);
        _run();

        _state(300e6, 300e6, 2); // fronts fill 2
        _run();
        _state(0, 0, 2);
        _fronted(2, 300e6, 300e6, 300e6, 2);
        _reimbursed(2, 300e6, 300e6, 2);
        _run();

        _state(200e6, 200e6, 3); // fill 3 requested
        _run();
        _liquidate(5e6); // bad debt
        CallbackResult[] memory r = _run();
        assertTrue(rc.halted());
        _only(r, address(vaultE), PULL_SEL); // repaid liquidity is still pulled for the queue

        _state(500e6, 500e6, 4);
        r = _run();
        for (uint256 i; i < r.length; ++i) {
            assertTrue(_sel(r[i].payload) != FRONT_SEL, "no fronting while halted");
        }

        rc.resume();
        _state(500e6, 500e6, 5);
        r = _run();
        bool fronted;
        for (uint256 i; i < r.length; ++i) {
            if (_sel(r[i].payload) == FRONT_SEL) fronted = true;
        }
        assertTrue(fronted, "fronting resumes");
    }

    function test_manualHalt_stopsFronting_morphoPathUnaffected() public {
        rc.halt();
        _fund(1_000e6, 1_000e6);
        _state(400e6, 400e6, 1);
        assertEq(_run().length, 0, "no front while halted");
        _repay(MARKET);
        _only(_run(), address(vaultE), PULL_SEL);
    }

    // ----- owner repair ----------------------------------------------------------------------------------------

    function test_resync_overwritesCaches() public {
        rc.resync(1, 2, 3, 4);
        assertEq(rc.pending(), 1);
        assertEq(rc.shortfall(), 2);
        assertEq(rc.inventory(), 3);
        assertEq(rc.credit(), 4);
    }

    function test_ownerFunctions_onlyOwner() public {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert();
        rc.resync(0, 0, 0, 0);
        vm.expectRevert();
        rc.setDelayBlocks(1);
        vm.expectRevert();
        rc.resume();
        vm.expectRevert();
        rc.halt();
        vm.expectRevert();
        rc.retryPull();
        vm.stopPrank();
    }

    function test_configure_onlyOnce() public {
        vm.expectRevert(SluiceReactive.AlreadyConfigured.selector);
        rc.configure(address(1), address(2), address(3), address(4), MARKET);
    }
}
