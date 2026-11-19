// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {RelayerReserve} from "../src/RelayerReserve.sol";
import {IRelayerReserve} from "../src/interfaces/IRelayerReserve.sol";
import {ISluiceVault} from "../src/interfaces/ISluiceVault.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";

/// @dev Records onFronted calls so tests can check the reserve's interaction with the vault.
contract VaultSpy {
    uint256 public calls;
    uint256 public lastAmount;
    uint256 public lastTrace;

    function onFronted(uint256, uint256 amount_, uint256 traceId_) external {
        calls++;
        lastAmount = amount_;
        lastTrace = traceId_;
    }
}

contract RelayerReserveTest is Test {
    RelayerReserve internal reserve;
    MockUSD internal usd;
    VaultSpy internal vault;

    address internal proxy = makeAddr("callbackProxy");
    address internal rvm = makeAddr("sluiceReactive");
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        usd = new MockUSD();
        vault = new VaultSpy();
        reserve = new RelayerReserve(IPayable(payable(proxy)), rvm, usd, ISluiceVault(address(vault)), relayer);
        usd.mint(relayer, 1_000e6);
        vm.startPrank(relayer);
        usd.approve(address(reserve), type(uint256).max);
        reserve.fund(500e6);
        vm.stopPrank();
    }

    function _front(uint256 fillId_, uint256 amount_, uint256 trace_) internal {
        vm.prank(proxy);
        reserve.front(rvm, fillId_, amount_, trace_);
    }

    function test_front_sendsToVault_andNotifiesIt() public {
        vm.expectEmit(address(reserve));
        emit IRelayerReserve.Fronted(1, 200e6, 200e6, 300e6, 42);
        _front(1, 200e6, 42);
        assertEq(usd.balanceOf(address(vault)), 200e6);
        assertEq(vault.calls(), 1);
        assertEq(vault.lastAmount(), 200e6);
        assertEq(vault.lastTrace(), 42);
    }

    function test_front_capsAtInventory() public {
        vm.expectEmit(address(reserve));
        emit IRelayerReserve.Fronted(1, 800e6, 500e6, 0, 1);
        _front(1, 800e6, 1);
        assertEq(usd.balanceOf(address(vault)), 500e6, "sent only what the reserve held");
    }

    function test_front_emptyInventory_sendsNothing_butVaultStillPublishesState() public {
        vm.prank(relayer);
        reserve.withdrawInventory(500e6);
        vm.expectEmit(address(reserve));
        emit IRelayerReserve.Fronted(1, 100e6, 0, 0, 1);
        _front(1, 100e6, 1);
        assertEq(usd.balanceOf(address(vault)), 0);
        assertEq(vault.calls(), 1, "vault asked to publish fresh state before the confirmation");
        assertEq(vault.lastAmount(), 0);
    }

    function test_front_isIdempotent_andReEmitsStoredResult() public {
        _front(7, 200e6, 5);
        uint256 vaultBalance = usd.balanceOf(address(vault));

        // A retried or duplicated callback, even with a different amount, moves no funds and re-confirms.
        vm.expectEmit(address(reserve));
        emit IRelayerReserve.Fronted(7, 200e6, 200e6, 300e6, 6);
        _front(7, 999e6, 6);

        assertEq(usd.balanceOf(address(vault)), vaultBalance, "no second payment");
        assertEq(vault.calls(), 2, "vault re-publishes state on the repeat, so the confirmation is never stale");
        assertEq(usd.balanceOf(address(reserve)), 300e6);
    }

    function test_front_rejectsNonProxy() public {
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), proxy));
        reserve.front(rvm, 1, 1, 1);
    }

    function test_front_rejectsWrongReactive() public {
        address impostor = makeAddr("impostor");
        vm.prank(proxy);
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, impostor, rvm));
        reserve.front(impostor, 1, 1, 1);
    }

    function test_fundAndWithdraw_onlyRelayer() public {
        vm.expectRevert(IRelayerReserve.NotRelayer.selector);
        reserve.fund(1);
        vm.expectRevert(IRelayerReserve.NotRelayer.selector);
        reserve.withdrawInventory(1);
    }

    function test_fund_emitsAbsoluteInventory() public {
        vm.expectEmit(address(reserve));
        emit IRelayerReserve.InventoryUpdated(600e6);
        vm.prank(relayer);
        reserve.fund(100e6);
    }
}
