// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ISystemFunds {
    function depositTo(address contract_) external payable;
    function debt(address contract_) external view returns (uint256);
}

/// @title LifelineReactive
/// @notice Reactive half of Lifeline. On Omni, a contract whose debt is above zero is silently blacklisted: its
///         `react()` or its callbacks simply stop, with no revert and no alert. This contract listens for the
///         blacklist event and revives the contract, spending only a budget its sponsor set in advance.
///         Two kinds of target:
///         - a callback recipient on Base or Unichain (a vault, a reserve): the proxy there emits
///           `BlacklistContract(target)`, and this contract asks a `LifelineFunder` on that chain to pay the debt;
///         - a reactive contract on Lasna: the system contract emits the event, and this contract pays the debt
///           itself with `depositTo` (the sponsor's budget is in lREACT held here).
/// @dev Every cache and decision uses absolute data from the event, `react()` never reverts to filter, repeats are
///      throttled by `minGap` (timestamps, not block counts), and the funder treats a repeat as a no-op.
contract LifelineReactive is AbstractReactive, Ownable {
    struct Watch {
        bool active;
        address proxy; // the proxy (or system contract) whose events we trust for this target
        address funder; // LifelineFunder on the target's chain; zero for a reactive-chain target
        uint64 minGap; // seconds between two rescue requests for this target
        uint64 lastRequest;
    }

    struct RxPolicy {
        uint128 budget; // lREACT held here for this target
        uint128 cap; // most one rescue may spend
        uint128 topUp; // extra above the debt
    }

    uint256 internal constant BLACKLIST_T0 = uint256(keccak256("BlacklistContract(address)"));
    uint256 internal constant WHITELIST_T0 = uint256(keccak256("WhitelistContract(address)"));
    uint64 public constant RESCUE_GAS = 300_000;

    mapping(bytes32 => Watch) public watches;
    mapping(address => RxPolicy) public rxPolicies;

    event Watching(uint256 indexed chainId, address indexed target, address proxy, address funder, uint64 minGap);
    event RescueRequested(uint256 indexed chainId, address indexed target, uint256 traceId);
    event ReactiveRescued(address indexed target, uint256 amount, uint256 debtBefore, uint256 traceId);
    event ReactiveRescueSkipped(address indexed target, uint8 reason, uint256 traceId);
    event Throttled(uint256 indexed chainId, address indexed target, uint256 traceId);
    event Revived(uint256 indexed chainId, address indexed target, uint256 traceId);
    event RxSponsored(address indexed target, uint256 added, uint256 budget);

    error BadPolicy();
    error ZeroValue();

    constructor() payable Ownable(msg.sender) {}

    // ---------------------------------------------------------------------------------------------------------
    // Owner: choose who is watched
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Watch a callback recipient on another chain. `proxy_` is that chain's callback proxy.
    function watchRemote(uint256 chainId_, address proxy_, address target_, address funder_, uint64 minGap_)
        external
        onlyOwner
    {
        watches[_key(chainId_, target_)] =
            Watch({active: true, proxy: proxy_, funder: funder_, minGap: minGap_, lastRequest: 0});
        SYSTEM.subscribe(chainId_, proxy_, BLACKLIST_T0, uint256(uint160(target_)), REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.subscribe(chainId_, proxy_, WHITELIST_T0, uint256(uint160(target_)), REACTIVE_IGNORE, REACTIVE_IGNORE);
        emit Watching(chainId_, target_, proxy_, funder_, minGap_);
    }

    /// @notice Watch a reactive contract on this chain. The system contract emits its blacklist events.
    function watchLocal(address target_, uint64 minGap_) external onlyOwner {
        watches[_key(block.chainid, target_)] =
            Watch({active: true, proxy: address(SYSTEM), funder: address(0), minGap: minGap_, lastRequest: 0});
        SYSTEM.subscribe(
            block.chainid, address(SYSTEM), BLACKLIST_T0, uint256(uint160(target_)), REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            block.chainid, address(SYSTEM), WHITELIST_T0, uint256(uint160(target_)), REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        emit Watching(block.chainid, target_, address(SYSTEM), address(0), minGap_);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Sponsors of reactive-chain targets
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Put lREACT behind a local target. Only what is sent here for that target can ever be spent on it.
    function sponsorLocal(address target_, uint128 cap_, uint128 topUp_) external payable {
        if (msg.value == 0) revert ZeroValue();
        if (cap_ == 0 || topUp_ > cap_) revert BadPolicy();
        RxPolicy storage p = rxPolicies[target_];
        if (p.cap == 0) {
            p.cap = cap_;
            p.topUp = topUp_;
        }
        p.budget += uint128(msg.value);
        emit RxSponsored(target_, msg.value, p.budget);
    }

    /// @notice Keep this contract's own `react()` fees in its system reserve, so they never draw on sponsor budgets.
    function fundSelf() external payable {
        ISystemFunds(address(SYSTEM)).depositTo{value: msg.value}(address(this));
    }

    function coverDebt() external {
        _coverDebt();
    }

    // ---------------------------------------------------------------------------------------------------------
    // react()
    // ---------------------------------------------------------------------------------------------------------

    function react(LogRecord calldata log_) external onlySystem {
        address target = address(uint160(log_.topic1));
        Watch storage w = watches[_key(log_.chainId, target)];
        if (!w.active || w.proxy != log_.contractAddress) return;

        if (log_.topic0 == WHITELIST_T0) {
            emit Revived(log_.chainId, target, log_.txHash);
            return;
        }
        if (log_.topic0 != BLACKLIST_T0) return;

        if (w.lastRequest != 0 && block.timestamp < uint256(w.lastRequest) + w.minGap) {
            emit Throttled(log_.chainId, target, log_.txHash);
            return;
        }
        w.lastRequest = uint64(block.timestamp);

        if (w.funder != address(0)) {
            SYSTEM.requestCallbackV_1_0(
                ISystemContract.CallbackConfiguration_V_1_0({
                    chainId: log_.chainId,
                    recipient: w.funder,
                    gasLimit: RESCUE_GAS,
                    payload: abi.encodeWithSignature("rescue(address,address,uint256)", address(0), target, log_.txHash)
                })
            );
            emit RescueRequested(log_.chainId, target, log_.txHash);
        } else {
            _rescueLocal(target, log_.txHash);
        }
    }

    /// @dev Pays a local target's debt from its sponsor's budget. A failure here is reported, never reverted.
    function _rescueLocal(address target_, uint256 traceId_) internal {
        RxPolicy storage p = rxPolicies[target_];
        if (p.cap == 0) return _skipLocal(target_, 1, traceId_);
        uint256 owed = ISystemFunds(address(SYSTEM)).debt(target_);
        if (owed == 0) return _skipLocal(target_, 2, traceId_);

        uint256 amount = owed + p.topUp;
        if (amount > p.cap) amount = p.cap;
        if (amount > p.budget) amount = p.budget;
        if (amount < owed) return _skipLocal(target_, 4, traceId_);

        p.budget -= uint128(amount);
        try ISystemFunds(address(SYSTEM)).depositTo{value: amount}(target_) {
            emit ReactiveRescued(target_, amount, owed, traceId_);
        } catch {
            p.budget += uint128(amount);
            _skipLocal(target_, 5, traceId_);
        }
    }

    function _skipLocal(address target_, uint8 reason_, uint256 traceId_) internal {
        emit ReactiveRescueSkipped(target_, reason_, traceId_);
    }

    function _key(uint256 chainId_, address target_) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId_, target_));
    }
}
