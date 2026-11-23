// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {ReactiveTest, FeeMode, CallbackResult} from "reactive-test-lib/ReactiveTest.sol";
import {LifelineFunder} from "../src/lifeline/LifelineFunder.sol";
import {LifelineReactive} from "../src/lifeline/LifelineReactive.sol";
import {LogEmitter} from "./helpers/LogEmitter.sol";

/// @dev Copies the debt and reserve rules of the Omni CallbackProxy
///      (system-smart-contracts/src/omni/base/AbstractProxiedPayableBridge.sol: `_deposit`, `_charge`), so the funder is
///      tested against the same accounting the live proxy uses.
contract MockProxy {
    event BlacklistContract(address indexed callback_);
    event WhitelistContract(address indexed callback_);

    mapping(address => uint256) public _reserves;
    mapping(address => uint256) public _debts;
    bool public failDeposits;

    function debt(address c_) external view returns (uint256) {
        return _debts[c_];
    }

    function reserves(address c_) external view returns (uint256) {
        return _reserves[c_];
    }

    function setFailDeposits(bool f_) external {
        failDeposits = f_;
    }

    /// @dev What the proxy does when a callback costs `amount_` and the contract has no reserves.
    function charge(address c_, uint256 amount_) external {
        uint256 current = _debts[c_];
        _debts[c_] += amount_;
        if (current == 0 && _debts[c_] > 0) emit BlacklistContract(c_);
    }

    function depositTo(address c_) external payable {
        require(!failDeposits, "deposit refused");
        _deposit(c_, msg.value);
    }

    function _deposit(address c_, uint256 amount_) internal {
        if (amount_ == 0) return;
        if (_debts[c_] > 0) {
            if (amount_ < _debts[c_]) {
                _debts[c_] -= amount_;
            } else {
                uint256 remainder = amount_ - _debts[c_];
                _debts[c_] = 0;
                emit WhitelistContract(c_);
                _deposit(c_, remainder);
            }
        } else {
            _reserves[c_] += amount_;
        }
    }

    receive() external payable {}
}

contract LifelineFunderTest is Test {
    LifelineFunder internal funder;
    MockProxy internal proxy;

    address internal rvm = makeAddr("lifelineReactive");
    address internal target = makeAddr("sluiceVault");
    address internal sponsorA = makeAddr("sponsorA");
    address internal other = makeAddr("other");

    function setUp() public {
        proxy = new MockProxy();
        funder = new LifelineFunder(IPayable(payable(address(proxy))), rvm);
        vm.deal(sponsorA, 100 ether);
        vm.deal(other, 100 ether);
        vm.warp(1_000_000);
    }

    function _sponsor(uint256 value_, uint128 cap_, uint128 topUp_, uint64 cooldown_) internal {
        vm.prank(sponsorA);
        funder.sponsor{value: value_}(target, cap_, topUp_, cooldown_);
    }

    function _rescue(uint256 trace_) internal {
        vm.prank(address(proxy));
        funder.rescue(rvm, target, trace_);
    }

    function _budget() internal view returns (uint128 b_) {
        (, b_,,,,) = funder.policies(target);
    }

    // ----- the rescue itself ---------------------------------------------------------------------------------

    function test_rescue_paysDebtPlusTopUp_andTargetIsRevived() public {
        _sponsor(1 ether, 0.1 ether, 0.01 ether, 60);
        proxy.charge(target, 0.02 ether);

        vm.expectEmit(address(proxy));
        emit MockProxy.WhitelistContract(target);
        vm.expectEmit(address(funder));
        emit LifelineFunder.Rescued(target, 0.03 ether, 0.02 ether, 7);
        _rescue(7);

        assertEq(proxy.debt(target), 0, "debt cleared");
        assertEq(proxy.reserves(target), 0.01 ether, "top-up lands in the target's reserves");
        assertEq(_budget(), 0.97 ether, "budget reduced by exactly what was sent");
        assertEq(funder.totalBudget(), 0.97 ether);
    }

    function test_rescue_repeat_isNoOp() public {
        _sponsor(1 ether, 0.1 ether, 0.01 ether, 60);
        proxy.charge(target, 0.02 ether);
        _rescue(1);
        uint256 budgetAfter = _budget();

        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_NOT_IN_DEBT(), 1);
        _rescue(1); // the same callback delivered twice

        assertEq(_budget(), budgetAfter, "a duplicate spends nothing");
        assertEq(proxy.reserves(target), 0.01 ether);
    }

    function test_rescue_cooldown_blocksASecondRescueTooSoon() public {
        _sponsor(1 ether, 0.1 ether, 0, 60);
        proxy.charge(target, 0.02 ether);
        _rescue(1);

        proxy.charge(target, 0.02 ether); // in debt again right away
        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_COOLDOWN(), 2);
        _rescue(2);
        assertEq(proxy.debt(target), 0.02 ether, "still in debt: the sponsor's limit held");

        vm.warp(block.timestamp + 61);
        _rescue(3);
        assertEq(proxy.debt(target), 0, "rescued once the cooldown passed");
    }

    function test_rescue_capBelowDebt_spendsNothing() public {
        _sponsor(1 ether, 0.05 ether, 0, 0);
        proxy.charge(target, 0.2 ether); // a hostile target ran up a debt far above what the sponsor allows
        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_BUDGET_TOO_SMALL(), 1);
        _rescue(1);
        assertEq(proxy.debt(target), 0.2 ether);
        assertEq(_budget(), 1 ether, "nothing spent on a rescue that could not clear the debt");
    }

    function test_rescue_budgetBelowDebt_spendsNothing() public {
        _sponsor(0.01 ether, 1 ether, 0, 0);
        proxy.charge(target, 0.02 ether);
        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_BUDGET_TOO_SMALL(), 1);
        _rescue(1);
        assertEq(_budget(), 0.01 ether);
    }

    function test_rescue_noPolicy_isSkipped() public {
        proxy.charge(target, 0.02 ether);
        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_NO_POLICY(), 1);
        _rescue(1);
    }

    function test_rescue_proxyRefusesDeposit_restoresBudgetAndNeverReverts() public {
        _sponsor(1 ether, 0.1 ether, 0, 0);
        proxy.charge(target, 0.02 ether);
        proxy.setFailDeposits(true);
        vm.expectEmit(address(funder));
        emit LifelineFunder.Skipped(target, funder.SKIP_TRANSFER_FAILED(), 1);
        _rescue(1);
        assertEq(_budget(), 1 ether);
        assertEq(funder.totalBudget(), 1 ether);
    }

    function test_rescue_onlyProxyWithReactivesAddress() public {
        _sponsor(1 ether, 0.1 ether, 0, 0);
        proxy.charge(target, 0.02 ether);

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, other, address(proxy)));
        funder.rescue(rvm, target, 1);

        vm.prank(address(proxy));
        vm.expectRevert();
        funder.rescue(other, target, 1); // the proxy relaying a call that did not come from our reactive contract
        assertEq(proxy.debt(target), 0.02 ether);
    }

    // ----- sponsors ------------------------------------------------------------------------------------------

    function test_sponsor_onlyFirstCallerSetsPolicy_othersCanOnlyAddBudget() public {
        _sponsor(1 ether, 0.1 ether, 0.01 ether, 60);
        vm.prank(other);
        funder.sponsor{value: 1 ether}(target, 50 ether, 40 ether, 0);
        (address s,, uint128 cap, uint128 topUp, uint64 cooldown,) = funder.policies(target);
        assertEq(s, sponsorA, "first caller stays the sponsor");
        assertEq(cap, 0.1 ether, "someone else cannot raise the cap");
        assertEq(topUp, 0.01 ether);
        assertEq(cooldown, 60);
        assertEq(_budget(), 2 ether, "but their money is added to the budget");
    }

    function test_policy_onlySponsorChanges() public {
        _sponsor(1 ether, 0.1 ether, 0, 0);
        vm.prank(other);
        vm.expectRevert(LifelineFunder.NotSponsor.selector);
        funder.setPolicy(target, 1 ether, 0, 0);

        vm.prank(sponsorA);
        funder.setPolicy(target, 0.5 ether, 0.1 ether, 30);
        (,, uint128 cap,,,) = funder.policies(target);
        assertEq(cap, 0.5 ether);
    }

    function test_policy_rejectsNonsense() public {
        vm.prank(sponsorA);
        vm.expectRevert(LifelineFunder.BadPolicy.selector);
        funder.sponsor{value: 1 ether}(target, 0, 0, 0);
        vm.prank(sponsorA);
        vm.expectRevert(LifelineFunder.BadPolicy.selector);
        funder.sponsor{value: 1 ether}(target, 1 ether, 2 ether, 0);
    }

    function test_withdraw_onlySponsor_andOnlyUnspentBudget() public {
        _sponsor(1 ether, 0.1 ether, 0, 0);
        proxy.charge(target, 0.02 ether);
        _rescue(1);

        vm.prank(other);
        vm.expectRevert(LifelineFunder.NotSponsor.selector);
        funder.withdraw(target, 1);

        uint256 before = sponsorA.balance;
        vm.prank(sponsorA);
        funder.withdraw(target, type(uint128).max);
        assertEq(sponsorA.balance - before, 0.98 ether, "gets back everything except what the rescue spent");
        assertEq(funder.totalBudget(), 0);
    }

    function test_fundSelf_goesToTheProxyReserve_notTheSponsorBudget() public {
        _sponsor(1 ether, 0.1 ether, 0, 0);
        vm.prank(other);
        funder.fundSelf{value: 0.5 ether}();
        assertEq(proxy.reserves(address(funder)), 0.5 ether);
        assertEq(_budget(), 1 ether);
    }

    /// @notice Whatever sequence of sponsoring, rescuing and withdrawing happens, every sponsor's budget stays backed.
    function testFuzz_budgetAlwaysBacked(uint256 seed_) public {
        for (uint256 i; i < 12; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed_, i)));
            uint256 pick = r % 4;
            if (pick == 0) {
                vm.prank(sponsorA);
                funder.sponsor{value: bound(r >> 8, 1, 2 ether)}(target, 0.5 ether, 0.01 ether, uint64(r % 120));
            } else if (pick == 1) {
                proxy.charge(target, bound(r >> 8, 1, 0.6 ether));
            } else if (pick == 2) {
                vm.warp(block.timestamp + (r % 200));
                _rescue(i);
            } else {
                (address s,,,,,) = funder.policies(target);
                if (s != address(0)) {
                    vm.prank(sponsorA);
                    funder.withdraw(target, uint128(bound(r >> 8, 1, 1 ether)));
                }
            }
            assertGe(address(funder).balance, funder.totalBudget(), "sponsor money is always there");
        }
    }
}

contract LifelineReactiveTest is ReactiveTest {
    uint256 internal constant LASNA = 5318007;
    uint256 internal constant BASE = 84532;
    bytes32 internal constant BLACKLIST_T0 = keccak256("BlacklistContract(address)");
    bytes32 internal constant WHITELIST_T0 = keccak256("WhitelistContract(address)");
    bytes4 internal constant RESCUE_SEL = bytes4(keccak256("rescue(address,address,uint256)"));

    LifelineReactive internal rc;
    LogEmitter internal proxyE; // stands in for the Base callback proxy
    LogEmitter internal funderE; // stands in for the LifelineFunder on Base
    address internal vault = makeAddr("sluiceVault");
    address internal other = makeAddr("someoneElse");

    function setUp() public {
        _reactiveSetUp(LASNA);
        _registerChain(BASE);
        proxyE = new LogEmitter();
        funderE = new LogEmitter();
        _registerContract(BASE, address(proxyE));
        _registerContract(BASE, address(funderE));

        rc = new LifelineReactive();
        _registerContract(LASNA, address(rc));
        vm.warp(1_000_000);
        rc.watchRemote(BASE, address(proxyE), vault, address(funderE), 30);
        _run();
    }

    function _run() internal returns (CallbackResult[] memory) {
        _switchToChain(LASNA);
        return _react(FeeMode.Subsidized);
    }

    function _emit(bytes32 t0_, address who_, LogEmitter from_) internal {
        _switchToChain(BASE);
        bytes32[] memory t = new bytes32[](2);
        t[0] = t0_;
        t[1] = bytes32(uint256(uint160(who_)));
        from_.emitLog(t, "");
    }

    function test_blacklist_ofWatchedTarget_requestsARescueOnTheTargetsChain() public {
        _emit(BLACKLIST_T0, vault, proxyE);
        CallbackResult[] memory r = _run();
        assertEq(r.length, 1, "one rescue request");
        assertEq(r[0].recipient, address(funderE));
        bytes4 sel;
        bytes memory p = r[0].payload;
        assembly {
            sel := mload(add(p, 32))
        }
        assertEq(sel, RESCUE_SEL);
        assertTrue(r[0].success);
        (address sender, address target,) = abi.decode(_tail(p), (address, address, uint256));
        assertEq(sender, address(rc), "network injected the reactive address");
        assertEq(target, vault);
    }

    function test_blacklist_ofSomeoneElse_isIgnored() public {
        _emit(BLACKLIST_T0, other, proxyE);
        assertEq(_run().length, 0);
    }

    function test_blacklist_fromTheWrongContract_isIgnored() public {
        LogEmitter fake = new LogEmitter();
        _registerContract(BASE, address(fake));
        _emit(BLACKLIST_T0, vault, fake);
        assertEq(_run().length, 0, "only the registered proxy is trusted");
    }

    function test_repeatedBlacklist_isThrottledByTimestamp() public {
        _emit(BLACKLIST_T0, vault, proxyE);
        assertEq(_run().length, 1);

        vm.warp(block.timestamp + 10);
        _emit(BLACKLIST_T0, vault, proxyE);
        assertEq(_run().length, 0, "inside minGap: no second request");

        vm.warp(block.timestamp + 40);
        _emit(BLACKLIST_T0, vault, proxyE);
        assertEq(_run().length, 1, "after minGap: allowed again");
    }

    function test_whitelist_emitsRevived_withoutACallback() public {
        _emit(WHITELIST_T0, vault, proxyE);
        _switchToChain(LASNA);
        vm.expectEmit(true, true, false, false, address(rc));
        emit LifelineReactive.Revived(BASE, vault, 0);
        CallbackResult[] memory r = _react(FeeMode.Subsidized);
        assertEq(r.length, 0, "no callback: revival is only recorded, so the harness can time blacklist to revival");
    }

    function test_onlyOwnerChoosesWho_isWatched() public {
        vm.prank(other);
        vm.expectRevert();
        rc.watchRemote(BASE, address(proxyE), other, address(funderE), 30);
        vm.prank(other);
        vm.expectRevert();
        rc.watchLocal(other, 30);
    }

    function test_localRescue_policyRules() public {
        vm.expectRevert(LifelineReactive.ZeroValue.selector);
        rc.sponsorLocal(other, 1 ether, 0);
        vm.expectRevert(LifelineReactive.BadPolicy.selector);
        rc.sponsorLocal{value: 1 ether}(other, 0, 0);
        rc.sponsorLocal{value: 1 ether}(other, 0.5 ether, 0.1 ether);
        (uint128 budget, uint128 cap, uint128 topUp) = rc.rxPolicies(other);
        assertEq(budget, 1 ether);
        assertEq(cap, 0.5 ether);
        assertEq(topUp, 0.1 ether);
    }

    function _tail(bytes memory p_) internal pure returns (bytes memory a_) {
        a_ = new bytes(p_.length - 4);
        for (uint256 i; i < a_.length; ++i) {
            a_[i] = p_[i + 4];
        }
    }
}
