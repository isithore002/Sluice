// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @notice The two callback-proxy calls Lifeline needs. Both exist on the Omni CallbackProxy
///         (system-smart-contracts/src/omni/base/AbstractProxiedPayableBridge.sol).
interface ICallbackProxyFunds {
    function depositTo(address contract_) external payable;
    function debt(address contract_) external view returns (uint256);
}

/// @title LifelineFunder
/// @notice Destination half of Lifeline (deploy one per chain, e.g. Base Sepolia and Unichain Sepolia).
///         When the callback proxy blacklists a contract for debt, it silently stops delivering that contract's
///         callbacks. A reactive contract sees the proxy's `BlacklistContract` event and calls `rescue` here, which
///         pays the debt (plus a small top-up) from a budget its sponsor chose in advance.
/// @dev A sponsor decides, per target, the most that can ever be spent on one rescue (`cap`), the top-up on top of
///      the debt, and the minimum time between rescues (`cooldown`). A buggy or hostile target can therefore burn
///      only what its sponsor put at risk. `rescue` never reverts (reverts are billed), repeats are no-ops, and the
///      funder's own callback fees must come from its reserve at the proxy (`fundSelf`), not from sponsor budgets.
contract LifelineFunder is AbstractCallback {
    struct Policy {
        address sponsor;
        uint128 budget;
        uint128 cap;
        uint128 topUp;
        uint64 cooldown;
        uint64 lastRescue;
    }

    /// @dev Why a rescue request did nothing.
    uint8 public constant SKIP_NO_POLICY = 1;
    uint8 public constant SKIP_NOT_IN_DEBT = 2;
    uint8 public constant SKIP_COOLDOWN = 3;
    uint8 public constant SKIP_BUDGET_TOO_SMALL = 4;
    uint8 public constant SKIP_TRANSFER_FAILED = 5;

    ICallbackProxyFunds public immutable PROXY;

    mapping(address => Policy) public policies;
    /// @notice Sum of every target's unspent budget, so the balance can be checked against what is owed to sponsors.
    uint256 public totalBudget;

    event Sponsored(address indexed target, address indexed sponsor, uint256 added, uint256 budget);
    event PolicySet(address indexed target, uint128 cap, uint128 topUp, uint64 cooldown);
    event Rescued(address indexed target, uint256 amount, uint256 debtBefore, uint256 traceId);
    event Skipped(address indexed target, uint8 reason, uint256 traceId);
    event BudgetWithdrawn(address indexed target, address indexed sponsor, uint256 amount);

    error NotSponsor();
    error BadPolicy();
    error ZeroValue();
    error WithdrawFailed();

    constructor(IPayable callbackProxy_, address callbackSender_)
        payable
        AbstractCallback(callbackProxy_, callbackSender_)
    {
        PROXY = ICallbackProxyFunds(address(callbackProxy_));
    }

    // ---------------------------------------------------------------------------------------------------------
    // Sponsors
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Add budget for `target`. The first caller becomes the sponsor and sets the policy; afterwards anyone
    ///         can add budget, but only the sponsor can change the policy or take budget back.
    /// @param cap_ Most that one rescue may spend (debt plus top-up).
    /// @param topUp_ Extra paid on top of the debt so the target has reserves afterwards.
    /// @param cooldown_ Minimum seconds between two rescues of this target.
    function sponsor(address target_, uint128 cap_, uint128 topUp_, uint64 cooldown_) external payable {
        if (msg.value == 0) revert ZeroValue();
        Policy storage p = policies[target_];
        if (p.sponsor == address(0)) {
            if (cap_ == 0 || topUp_ > cap_) revert BadPolicy();
            p.sponsor = msg.sender;
            p.cap = cap_;
            p.topUp = topUp_;
            p.cooldown = cooldown_;
            emit PolicySet(target_, cap_, topUp_, cooldown_);
        }
        p.budget += uint128(msg.value);
        totalBudget += msg.value;
        emit Sponsored(target_, msg.sender, msg.value, p.budget);
    }

    function setPolicy(address target_, uint128 cap_, uint128 topUp_, uint64 cooldown_) external {
        Policy storage p = policies[target_];
        if (msg.sender != p.sponsor) revert NotSponsor();
        if (cap_ == 0 || topUp_ > cap_) revert BadPolicy();
        p.cap = cap_;
        p.topUp = topUp_;
        p.cooldown = cooldown_;
        emit PolicySet(target_, cap_, topUp_, cooldown_);
    }

    /// @notice The sponsor takes back unspent budget.
    function withdraw(address target_, uint128 amount_) external {
        Policy storage p = policies[target_];
        if (msg.sender != p.sponsor) revert NotSponsor();
        if (amount_ > p.budget) amount_ = p.budget;
        p.budget -= amount_;
        totalBudget -= amount_;
        (bool ok,) = payable(msg.sender).call{value: amount_}("");
        if (!ok) revert WithdrawFailed();
        emit BudgetWithdrawn(target_, msg.sender, amount_);
    }

    /// @notice Pre-fund this contract's own callback fees at the proxy, so they never draw on sponsor budgets.
    function fundSelf() external payable {
        PROXY.depositTo{value: msg.value}(address(this));
    }

    /// @notice Settle this contract's own proxy debt from its balance.
    function coverDebt() external {
        _coverDebt();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Reactive callback
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Reactive callback: `target_` was blacklisted for debt, so pay it off within its sponsor's limits.
    /// @dev Never reverts after the auth checks. A repeated or late request finds the target out of debt and is a
    ///      no-op, which makes duplicated deliveries harmless.
    function rescue(address rvm_, address target_, uint256 traceId_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm_)
    {
        Policy storage p = policies[target_];
        if (p.sponsor == address(0)) return _skip(target_, SKIP_NO_POLICY, traceId_);

        uint256 owed = PROXY.debt(target_);
        if (owed == 0) return _skip(target_, SKIP_NOT_IN_DEBT, traceId_);
        if (p.lastRescue != 0 && block.timestamp < uint256(p.lastRescue) + p.cooldown) {
            return _skip(target_, SKIP_COOLDOWN, traceId_);
        }

        uint256 amount = owed + p.topUp;
        if (amount > p.cap) amount = p.cap;
        if (amount > p.budget) amount = p.budget;
        // Paying part of a debt does not bring the target back, so don't spend anything unless it clears.
        if (amount < owed) return _skip(target_, SKIP_BUDGET_TOO_SMALL, traceId_);

        p.budget -= uint128(amount);
        totalBudget -= amount;
        p.lastRescue = uint64(block.timestamp);
        try PROXY.depositTo{value: amount}(target_) {
            emit Rescued(target_, amount, owed, traceId_);
        } catch {
            p.budget += uint128(amount);
            totalBudget += amount;
            _skip(target_, SKIP_TRANSFER_FAILED, traceId_);
        }
    }

    function _skip(address target_, uint8 reason_, uint256 traceId_) internal {
        emit Skipped(target_, reason_, traceId_);
    }
}
