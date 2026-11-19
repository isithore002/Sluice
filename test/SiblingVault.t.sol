// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {SiblingVault} from "../src/SiblingVault.sol";
import {ISiblingVault} from "../src/interfaces/ISiblingVault.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";

contract SiblingVaultTest is Test {
    SiblingVault internal sibling;
    MockUSD internal usd;

    address internal proxy = makeAddr("callbackProxy");
    address internal rvm = makeAddr("sluiceReactive");
    address internal payee = makeAddr("relayerPayee");
    address internal lp = makeAddr("lp");

    uint256 internal constant BUFFER = 300e6;

    function setUp() public {
        usd = new MockUSD();
        sibling = new SiblingVault(IPayable(payable(proxy)), rvm, usd, payee, BUFFER, address(this));
        usd.mint(lp, 1_000e6);
        vm.startPrank(lp);
        usd.approve(address(sibling), type(uint256).max);
        sibling.deposit(1_000e6);
        vm.stopPrank();
    }

    function _reimburse(uint256 fillId_, uint256 amount_, uint256 trace_) internal {
        vm.prank(proxy);
        sibling.reimburse(rvm, fillId_, amount_, trace_);
    }

    function test_commitCredit_respectsSafetyBuffer() public {
        vm.expectEmit(address(sibling));
        emit ISiblingVault.CreditCommitted(700e6);
        sibling.commitCredit();
        assertEq(sibling.creditAvailable(), 700e6, "everything above the 300 buffer");
    }

    function test_commitCredit_onlyOwner() public {
        vm.prank(lp);
        vm.expectRevert();
        sibling.commitCredit();
    }

    function test_localWithdraw_cannotTouchCredit() public {
        sibling.commitCredit(); // 700 committed, 300 uncommitted
        vm.startPrank(lp);
        vm.expectRevert(ISiblingVault.ExceedsUncommitted.selector);
        sibling.withdraw(301e6);
        sibling.withdraw(300e6);
        vm.stopPrank();
        assertEq(sibling.creditAvailable(), 700e6, "credit intact");
    }

    function test_reimburse_paysPayee_andReducesCredit() public {
        sibling.commitCredit();
        vm.expectEmit(address(sibling));
        emit ISiblingVault.Reimbursed(1, 200e6, 500e6, 9);
        _reimburse(1, 200e6, 9);
        assertEq(usd.balanceOf(payee), 200e6);
        assertEq(sibling.paidAmount(1), 200e6);
    }

    function test_reimburse_isIdempotent_andReEmitsStoredPayment() public {
        sibling.commitCredit();
        _reimburse(1, 200e6, 9);
        vm.expectEmit(address(sibling));
        emit ISiblingVault.Reimbursed(1, 200e6, 500e6, 10);
        _reimburse(1, 999e6, 10);
        assertEq(usd.balanceOf(payee), 200e6, "paid once");
    }

    function test_reimburse_withoutCredit_emitsFailed_doesNotRevert_andCanRetry() public {
        vm.expectEmit(address(sibling));
        emit ISiblingVault.ReimburseFailed(1, 200e6, 0);
        _reimburse(1, 200e6, 9);
        assertEq(sibling.paidAmount(1), 0, "not marked paid");

        sibling.commitCredit();
        _reimburse(1, 200e6, 9);
        assertEq(usd.balanceOf(payee), 200e6, "retry succeeds once credit exists");
    }

    function test_reimburse_neverExceedsCredit() public {
        sibling.commitCredit(); // 700
        _reimburse(1, 701e6, 1);
        assertEq(usd.balanceOf(payee), 0);
        assertEq(sibling.creditAvailable(), 700e6);
    }

    function test_reimburse_rejectsNonProxy() public {
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), proxy));
        sibling.reimburse(rvm, 1, 1, 1);
    }

    function test_reimburse_rejectsWrongReactive() public {
        address impostor = makeAddr("impostor");
        vm.prank(proxy);
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, impostor, rvm));
        sibling.reimburse(impostor, 1, 1, 1);
    }
}
