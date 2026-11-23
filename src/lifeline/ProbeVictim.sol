// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";

/// @title ProbeVictim
/// @notice Testnet scaffolding for the Lifeline live probe, not part of Sluice. A reactive contract that subscribes to
///         Cron10 and does nothing else. Deployed with no lREACT it incurs debt on its first reaction and is
///         blacklisted by the network, which is exactly the silent failure Lifeline exists to repair.
contract ProbeVictim is AbstractReactive {
    address internal constant CRON_SOURCE = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant CRON10_T0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    address public immutable OWNER;
    uint256 public ticks;
    uint256 public lastTickBlock;

    event Ticked(uint256 ticks, uint256 blockNumber);

    constructor() payable {
        OWNER = msg.sender;
        SYSTEM.subscribe(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function react(LogRecord calldata) external onlySystem {
        ++ticks;
        lastTickBlock = block.number;
        emit Ticked(ticks, block.number);
    }

    /// @notice Stop the Cron subscription so a finished probe stops costing lREACT.
    function stop() external {
        require(msg.sender == OWNER, "owner only");
        SYSTEM.unsubscribe(block.chainid, CRON_SOURCE, CRON10_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }
}
