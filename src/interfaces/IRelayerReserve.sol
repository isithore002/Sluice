// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title IRelayerReserve
/// @notice Base Sepolia reserve that fronts payouts to the vault queue. Events are what SluiceReactive subscribes to.
interface IRelayerReserve {
    /// @notice Emitted on first processing of a fill AND re-emitted with the stored values on any repeat.
    event Fronted(uint256 indexed fillId, uint256 requested, uint256 sent, uint256 inventory, uint256 traceId);
    event InventoryUpdated(uint256 inventory);

    error NotRelayer();

    function front(address rvm, uint256 fillId, uint256 amount, uint256 traceId) external;
    function fund(uint256 amount) external;
    function withdrawInventory(uint256 amount) external;
}
