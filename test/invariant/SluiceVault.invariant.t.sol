// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IMorpho, MarketParams, Market, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MockUSD} from "../../src/mocks/MockUSD.sol";
import {MockCollateral} from "../../src/mocks/MockCollateral.sol";
import {SluiceVault} from "../../src/SluiceVault.sol";
import {SluiceTestBase} from "../helpers/SluiceTestBase.sol";

/// @notice Drives the vault with arbitrary sequences of user and Reactive actions against the REAL Morpho bytecode.
///         Every call here is one a real participant (or Reactive's callback proxy) could make, and none of them may
///         revert: the vault must never fail a billed callback or strand a user.
contract SluiceVaultHandler is Test {
    SluiceVault public immutable VAULT;
    IMorpho public immutable MORPHO;
    MockUSD public immutable USD;
    MockCollateral public immutable COL;
    MarketParams internal _params;
    address public immutable PROXY;
    address public immutable RVM;
    address public immutable BORROWER;

    address[] public actors;

    /// @dev Everything ever deposited into the vault (in assets).
    uint256 public ghostDeposited;
    /// @dev Nominal size of every request that joined the queue, by request id.
    mapping(uint256 => uint256) public requested;
    uint256 public calls;

    constructor(
        SluiceVault vault_,
        IMorpho morpho_,
        MockUSD usd_,
        MockCollateral col_,
        MarketParams memory params_,
        address proxy_,
        address rvm_,
        address borrower_
    ) {
        VAULT = vault_;
        MORPHO = morpho_;
        USD = usd_;
        COL = col_;
        _params = params_;
        PROXY = proxy_;
        RVM = rvm_;
        BORROWER = borrower_;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function deposit(uint256 seed_, uint256 assets_) external {
        address a = actors[seed_ % actors.length];
        assets_ = bound(assets_, 1e6, 500e6);
        USD.mint(a, assets_);
        vm.startPrank(a);
        USD.approve(address(VAULT), assets_);
        VAULT.deposit(assets_);
        vm.stopPrank();
        ghostDeposited += assets_;
        ++calls;
    }

    function requestWithdraw(uint256 seed_, uint256 assets_) external {
        address a = actors[seed_ % actors.length];
        uint256 shares = VAULT.sharesOf(a);
        if (shares == 0) return;
        assets_ = bound(assets_, 1, shares);
        vm.prank(a);
        (bool queued, uint256 id) = VAULT.requestWithdraw(assets_);
        if (queued) requested[id] = assets_;
        ++calls;
    }

    /// @dev The demo borrower takes every unit of free cash: 100% utilization.
    function borrowAll() external {
        Market memory m = MORPHO.market(_id());
        uint256 free = m.totalSupplyAssets - m.totalBorrowAssets;
        if (free == 0) return;
        uint256 collateral = free * 2e12;
        COL.mint(BORROWER, collateral);
        vm.startPrank(BORROWER);
        COL.approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(_params, collateral, BORROWER, "");
        MORPHO.borrow(_params, free, 0, BORROWER, BORROWER);
        vm.stopPrank();
        ++calls;
    }

    /// @dev Anyone can repay on behalf of the borrower, which is the event Sluice reacts to.
    function repay(uint256 assets_) external {
        uint256 debt = MORPHO.market(_id()).totalBorrowAssets;
        if (debt == 0) return;
        assets_ = bound(assets_, 1, debt);
        USD.mint(BORROWER, assets_);
        vm.startPrank(BORROWER);
        USD.approve(address(MORPHO), type(uint256).max);
        MORPHO.repay(_params, assets_, 0, BORROWER, "");
        vm.stopPrank();
        ++calls;
    }

    /// @dev Reactive's callback. It must never revert, even when there is nothing to do.
    function pull(uint256 trace_) external {
        vm.prank(PROXY);
        VAULT.pullFromMorpho(RVM, trace_);
        ++calls;
    }

    function poke() external {
        VAULT.poke();
        ++calls;
    }

    function _id() internal view returns (Id) {
        return Id.wrap(keccak256(abi.encode(_params)));
    }
}

contract SluiceVaultInvariantTest is SluiceTestBase {
    SluiceVault internal vault;
    SluiceVaultHandler internal handler;

    address internal proxy = makeAddr("callbackProxy");
    address internal rvm = makeAddr("sluiceReactive");

    function setUp() public {
        _setUpMorphoMarket();
        vault = new SluiceVault(IPayable(payable(proxy)), rvm, morpho, params, address(this));
        handler = new SluiceVaultHandler(vault, morpho, usd, col, params, proxy, rvm, borrower);
        targetContract(address(handler));
    }

    function _sumShares() internal view returns (uint256 s) {
        for (uint256 i; i < handler.actorCount(); ++i) {
            s += vault.sharesOf(handler.actors(i));
        }
    }

    function _sumActorCash() internal view returns (uint256 s) {
        for (uint256 i; i < handler.actorCount(); ++i) {
            s += usd.balanceOf(handler.actors(i));
        }
    }

    /// @notice Conservation: every unit ever deposited is either still owned as shares, owed in the queue, or
    ///         already in a user's wallet. Nothing is created or lost.
    function invariant_conservation() public view {
        assertEq(_sumActorCash() + _sumShares() + vault.pendingTotal(), handler.ghostDeposited());
    }

    /// @notice Solvency: what the vault holds or can claim from Morpho covers everything it owes, to within one wei
    ///         of Morpho's rounding per call.
    function invariant_solvency() public view {
        uint256 assets = vault.idle() + vault.morphoSupplied();
        uint256 owed = _sumShares() + vault.pendingTotal();
        assertGe(assets + handler.calls(), owed, "vault insolvent");
    }

    /// @notice `pendingTotal` is exactly what the queue still owes, from the head on.
    function invariant_pendingEqualsQueue() public view {
        uint256 sum;
        uint256 len = vault.queueLength();
        for (uint256 i = vault.head(); i < len; ++i) {
            (, uint256 rem) = vault.request(i);
            sum += rem;
        }
        assertEq(vault.pendingTotal(), sum);
    }

    /// @notice Strict first come, first served: nothing before the head is owed, and nobody behind the head has been
    ///         paid a single unit while the head is still waiting.
    function invariant_fifo() public view {
        uint256 head = vault.head();
        uint256 len = vault.queueLength();
        assertLe(head, len);
        for (uint256 i; i < head; ++i) {
            (, uint256 rem) = vault.request(i);
            assertEq(rem, 0, "paid-off prefix still owed");
        }
        for (uint256 i = head + 1; i < len; ++i) {
            (, uint256 rem) = vault.request(i);
            assertEq(rem, handler.requested(i), "someone behind the head was paid early");
        }
    }

    /// @notice No request is ever owed more than it asked for.
    function invariant_noOverOwing() public view {
        uint256 len = vault.queueLength();
        for (uint256 i = vault.head(); i < len; ++i) {
            (, uint256 rem) = vault.request(i);
            assertLe(rem, handler.requested(i));
        }
    }
}
