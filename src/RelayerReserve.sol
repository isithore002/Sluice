// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRelayerReserve} from "./interfaces/IRelayerReserve.sol";
import {ISluiceVault} from "./interfaces/ISluiceVault.sol";

/// @title RelayerReserve
/// @notice Relayer inventory on Base Sepolia. On a Reactive callback it fronts assets to the SluiceVault queue;
///         the relayer is reimbursed later on Unichain by the SiblingVault, for exactly the amount sent here.
/// @dev `front` is idempotent per fillId: a repeat changes no balances and re-emits the stored result, so a
///      retried or duplicated callback can never pay twice and always confirms.
contract RelayerReserve is IRelayerReserve, AbstractCallback {
    using SafeERC20 for IERC20;

    struct Fill {
        bool done;
        uint256 requested;
        uint256 sent;
    }

    IERC20 public immutable ASSET;
    ISluiceVault public immutable VAULT;
    address public immutable RELAYER;

    mapping(uint256 => Fill) public fills;

    modifier onlyRelayer() {
        _onlyRelayer();
        _;
    }

    constructor(IPayable callbackProxy_, address callbackSender_, IERC20 asset_, ISluiceVault vault_, address relayer_)
        payable
        AbstractCallback(callbackProxy_, callbackSender_)
    {
        ASSET = asset_;
        VAULT = vault_;
        RELAYER = relayer_;
    }

    /// @notice Reactive callback: front up to `amount_` to the vault queue for `fillId_`.
    function front(address rvm_, uint256 fillId_, uint256 amount_, uint256 traceId_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm_)
    {
        Fill storage f = fills[fillId_];
        if (!f.done) {
            uint256 balance = ASSET.balanceOf(address(this));
            uint256 sent = amount_ < balance ? amount_ : balance;
            f.done = true;
            f.requested = amount_;
            f.sent = sent;
            if (sent > 0) ASSET.safeTransfer(address(VAULT), sent);
        }

        // ALWAYS let the vault settle and publish fresh absolute state (StateUpdated) BEFORE confirming, including
        // on repeats and when nothing was sent. SluiceReactive therefore never sees a Fronted without a current
        // shortfall in front of it: even if it missed both events of the original execution, the retry delivers
        // fresh state first, so it can never front the same shortfall twice.
        VAULT.onFronted(fillId_, f.sent, traceId_);
        emit Fronted(fillId_, f.requested, f.sent, ASSET.balanceOf(address(this)), traceId_);
    }

    function fund(uint256 amount_) external onlyRelayer {
        ASSET.safeTransferFrom(msg.sender, address(this), amount_);
        emit InventoryUpdated(ASSET.balanceOf(address(this)));
    }

    function withdrawInventory(uint256 amount_) external onlyRelayer {
        ASSET.safeTransfer(msg.sender, amount_);
        emit InventoryUpdated(ASSET.balanceOf(address(this)));
    }

    /// @notice Settle callback-proxy debt from this contract's ETH balance.
    function coverDebt() external {
        _coverDebt();
    }

    function _onlyRelayer() internal view {
        if (msg.sender != RELAYER) revert NotRelayer();
    }
}
