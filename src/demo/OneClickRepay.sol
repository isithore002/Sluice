// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

interface IOpenMintToken {
    function mint(address to_, uint256 amount_) external;
    function approve(address spender_, uint256 amount_) external returns (bool);
}

/// @title OneClickRepay
/// @notice Lets anyone trigger a real Sluice settlement from their own wallet in ONE transaction. It does exactly what
///         the README's three `cast` commands do (mint the open-mint demo token, approve Morpho, repay part of the demo
///         borrower's debt on their behalf), folded into one call, so a visitor confirms a single transaction.
/// @dev Testnet demo helper. Morpho emits `Repay` inside the caller's own transaction, and SluiceReactive reacts to it
///      like to any other repayment in the market: nothing here talks to Sluice directly. The amount is fixed so one
///      call frees exactly one queued demo withdrawal.
contract OneClickRepay {
    IMorpho public immutable MORPHO;
    IOpenMintToken public immutable TOKEN;
    address public immutable BORROWER;
    uint256 public immutable AMOUNT;

    MarketParams internal _params;

    event Triggered(address indexed caller, uint256 assets);

    constructor(IMorpho morpho_, MarketParams memory params_, address borrower_, uint256 amount_) {
        MORPHO = morpho_;
        TOKEN = IOpenMintToken(params_.loanToken);
        BORROWER = borrower_;
        AMOUNT = amount_;
        _params = params_;
        IOpenMintToken(params_.loanToken).approve(address(morpho_), type(uint256).max);
    }

    /// @notice Repay `AMOUNT` of the demo borrower's Morpho debt. Anyone can call it; it costs only gas.
    function settle() external {
        TOKEN.mint(address(this), AMOUNT);
        MORPHO.repay(_params, AMOUNT, 0, BORROWER, "");
        emit Triggered(msg.sender, AMOUNT);
    }

    function marketParams() external view returns (MarketParams memory) {
        return _params;
    }
}
