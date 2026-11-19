// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockCollateral
/// @notice Testnet-only collateral token (18 decimals) the demo borrower posts on Morpho. Anyone can mint.
contract MockCollateral is ERC20 {
    constructor() ERC20("Mock Collateral", "mCOL") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }
}
