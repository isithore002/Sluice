// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";

/// @title FixedOracle
/// @notice Morpho oracle returning a constant price, scaled by 1e36 and adjusted for decimals.
/// @dev For 1 MockCollateral (18 decimals) = 1 MockUSD (6 decimals): 1e36 * 1e6 / 1e18 = 1e24.
contract FixedOracle is IOracle {
    uint256 public immutable PRICE;

    constructor(uint256 price_) {
        PRICE = price_;
    }

    function price() external view returns (uint256) {
        return PRICE;
    }
}
