// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title ISiblingVault
/// @notice Unichain Sepolia vault whose surplus above a safety buffer backs cross-chain fronts.
interface ISiblingVault {
    event Deposited(address indexed owner, uint256 assets);
    event Withdrawn(address indexed owner, uint256 assets);
    event CreditCommitted(uint256 creditAvailable);
    /// @notice Emitted on payment AND re-emitted with the stored amount on any repeat.
    event Reimbursed(uint256 indexed fillId, uint256 amount, uint256 creditAvailable, uint256 traceId);
    event ReimburseFailed(uint256 indexed fillId, uint256 amount, uint256 creditAvailable);
    event SafetyBufferSet(uint256 safetyBuffer);
    event RelayerPayeeSet(address relayerPayee);

    error ZeroAmount();
    error InsufficientShares();
    error ExceedsUncommitted();

    function deposit(uint256 assets) external;
    function withdraw(uint256 assets) external;
    function commitCredit() external;
    function reimburse(address rvm, uint256 fillId, uint256 amount, uint256 traceId) external;
}
