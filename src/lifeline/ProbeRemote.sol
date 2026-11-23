// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @title CallbackSink
/// @notice Testnet scaffolding for the Lifeline live probe, not part of Sluice. A callback recipient on Base or
///         Unichain that does nothing but record each callback. Deployed without reserves at the callback proxy, it
///         incurs debt on its first callback and is blacklisted, like a vault whose ETH ran out.
contract CallbackSink is AbstractCallback {
    uint256 public pings;
    uint256 public lastTrace;

    event Pinged(uint256 pings, uint256 trace);

    constructor(IPayable callbackProxy_, address callbackSender_)
        payable
        AbstractCallback(callbackProxy_, callbackSender_)
    {}

    function ping(address rvm_, uint256 trace_) external onlyServiceProvider onlyCallbackSender(rvm_) {
        ++pings;
        lastTrace = trace_;
        emit Pinged(pings, trace_);
    }
}

/// @title ProbeRemoteTrigger
/// @notice Testnet scaffolding for the Lifeline live probe, not part of Sluice. A reactive contract on Lasna that sends
///         one callback to a `CallbackSink` on every Cron10 tick, so the sink keeps being charged at its proxy.
contract ProbeRemoteTrigger is AbstractReactive {
    address internal constant CRON_SOURCE = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant CRON10_T0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    address public immutable OWNER;
    uint256 public immutable DEST_CHAIN;
    address public sink;
    uint256 public sent;

    event Triggered(uint256 sent, uint256 blockNumber);

    constructor(uint256 destChain_) payable {
        OWNER = msg.sender;
        DEST_CHAIN = destChain_;
    }

    /// @notice Point the trigger at its sink and start the Cron subscription.
    function start(address sink_) external {
        require(msg.sender == OWNER && sink == address(0), "owner, once");
        sink = sink_;
        SYSTEM.subscribe(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function stop() external {
        require(msg.sender == OWNER, "owner only");
        SYSTEM.unsubscribe(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function react(LogRecord calldata) external onlySystem {
        ++sent;
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: DEST_CHAIN,
                recipient: sink,
                gasLimit: 500_000,
                payload: abi.encodeWithSignature("ping(address,uint256)", address(0), sent)
            })
        );
        emit Triggered(sent, block.number);
    }
}
