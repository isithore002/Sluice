// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title ISluiceVault
/// @notice Events and entry points of the Base Sepolia vault. Event signatures are what SluiceReactive subscribes to.
interface ISluiceVault {
    event Deposited(address indexed owner, uint256 assets);
    event WithdrawQueued(uint256 indexed requestId, address indexed owner, uint256 assets);
    event WithdrawPaidInstantly(address indexed owner, uint256 assets);
    event WithdrawSettled(
        uint256 indexed requestId, address indexed owner, uint256 paid, uint256 remaining, uint256 traceId
    );
    /// @notice Absolute queue state after every state change. SluiceReactive subscribes to this.
    event StateUpdated(uint256 pendingTotal, uint256 shortfall, uint256 traceId);
    event Allocated(uint256 assets);
    event PulledFromMorpho(uint256 assets, uint256 traceId);
    event ReserveSet(address reserve);
    event BufferTargetSet(uint256 bufferTarget);

    error ZeroAmount();
    error InsufficientShares();
    error NotReserve();
    error ReserveAlreadySet();

    function deposit(uint256 assets) external;
    function requestWithdraw(uint256 assets) external returns (bool queued, uint256 requestId);
    function pullFromMorpho(address rvm, uint256 traceId) external;
    function onFronted(uint256 fillId, uint256 amount, uint256 traceId) external;
    function poke() external;

    function pendingTotal() external view returns (uint256);
    function shortfall() external view returns (uint256);
    function morphoWithdrawable() external view returns (uint256);
}
