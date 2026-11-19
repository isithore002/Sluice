// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISiblingVault} from "./interfaces/ISiblingVault.sol";

/// @title SiblingVault
/// @notice Unichain Sepolia half of the logical vault. Surplus above a safety buffer is committed as credit that
///         backs cross-chain fronts on Base; a Reactive callback reimburses the relayer from that credit.
/// @dev `reimburse` is idempotent per fillId (repeats re-emit the stored payment) and never reverts for lack of
///      credit: it emits ReimburseFailed so SluiceReactive can retry once credit is committed.
///      The safety buffer keeps a floor of local liquidity that can never be sent to another chain.
contract SiblingVault is ISiblingVault, AbstractCallback, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable ASSET;

    address public relayerPayee;
    uint256 public safetyBuffer;
    uint256 public creditAvailable;

    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    /// @notice Amount paid per fill; zero means not yet paid.
    mapping(uint256 => uint256) public paidAmount;

    constructor(
        IPayable callbackProxy_,
        address callbackSender_,
        IERC20 asset_,
        address relayerPayee_,
        uint256 safetyBuffer_,
        address owner_
    ) payable AbstractCallback(callbackProxy_, callbackSender_) Ownable(owner_) {
        ASSET = asset_;
        relayerPayee = relayerPayee_;
        safetyBuffer = safetyBuffer_;
    }

    function deposit(uint256 assets_) external {
        if (assets_ == 0) revert ZeroAmount();
        ASSET.safeTransferFrom(msg.sender, address(this), assets_);
        sharesOf[msg.sender] += assets_;
        totalShares += assets_;
        emit Deposited(msg.sender, assets_);
    }

    /// @notice Local withdrawals can only use liquidity that isn't committed as credit.
    function withdraw(uint256 assets_) external {
        if (assets_ == 0) revert ZeroAmount();
        if (sharesOf[msg.sender] < assets_) revert InsufficientShares();
        if (assets_ > _uncommitted()) revert ExceedsUncommitted();
        sharesOf[msg.sender] -= assets_;
        totalShares -= assets_;
        ASSET.safeTransfer(msg.sender, assets_);
        emit Withdrawn(msg.sender, assets_);
    }

    /// @notice Commit surplus above the safety buffer as cross-chain credit. Curator decision, so owner-only.
    function commitCredit() external onlyOwner {
        uint256 balance = ASSET.balanceOf(address(this));
        if (balance > safetyBuffer) {
            uint256 committable = balance - safetyBuffer;
            if (committable > creditAvailable) creditAvailable = committable;
        }
        emit CreditCommitted(creditAvailable);
    }

    /// @notice Reactive callback: reimburse the relayer for fill `fillId_` with exactly `amount_` (the amount the
    ///         reserve actually sent on Base).
    function reimburse(address rvm_, uint256 fillId_, uint256 amount_, uint256 traceId_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm_)
    {
        uint256 paid = paidAmount[fillId_];
        if (paid != 0) {
            emit Reimbursed(fillId_, paid, creditAvailable, traceId_);
            return;
        }
        if (amount_ == 0 || amount_ > creditAvailable) {
            emit ReimburseFailed(fillId_, amount_, creditAvailable);
            return;
        }
        creditAvailable -= amount_;
        paidAmount[fillId_] = amount_;
        ASSET.safeTransfer(relayerPayee, amount_);
        emit Reimbursed(fillId_, amount_, creditAvailable, traceId_);
    }

    function setSafetyBuffer(uint256 safetyBuffer_) external onlyOwner {
        safetyBuffer = safetyBuffer_;
        emit SafetyBufferSet(safetyBuffer_);
    }

    function setRelayerPayee(address relayerPayee_) external onlyOwner {
        relayerPayee = relayerPayee_;
        emit RelayerPayeeSet(relayerPayee_);
    }

    /// @notice Settle callback-proxy debt from this contract's ETH balance.
    function coverDebt() external {
        _coverDebt();
    }

    function _uncommitted() internal view returns (uint256) {
        uint256 balance = ASSET.balanceOf(address(this));
        return balance > creditAvailable ? balance - creditAvailable : 0;
    }
}
