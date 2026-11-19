// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";

interface IDepositTo {
    function depositTo(address contract_) external payable;
}

/// @notice Shared constants and helpers for the Sluice deployment scripts. Addresses verified Nov 19, 2026
///         (see docs/ARCHITECTURE.md §1). Each script records what it deployed in ./deployments.
abstract contract SluiceScript is Script {
    uint256 internal constant BASE = 84532;
    uint256 internal constant UNI = 1301;
    uint256 internal constant LASNA = 5318007;

    address internal constant MORPHO = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address payable internal constant BASE_PROXY = payable(0x476F44b11F5C942c58f4c8E3d0300E5710743585);
    address payable internal constant UNI_PROXY = payable(0x775c9B990ADe401060B78D0e98684eEf8d2466C1);

    uint256 internal constant LLTV = 0.86e18;
    /// @dev 1 MockCollateral (18 decimals) = 1 MockUSD (6 decimals) at Morpho's 1e36 scale.
    uint256 internal constant ORACLE_PRICE = 1e24;

    string internal constant MARKET_FILE = "deployments/base-market.json";
    string internal constant UNI_TOKEN_FILE = "deployments/unichain-token.json";
    string internal constant REACTIVE_FILE = "deployments/lasna-reactive.json";
    string internal constant BASE_FILE = "deployments/base-sluice.json";
    string internal constant UNI_FILE = "deployments/unichain-sluice.json";

    function _requireChain(uint256 chainId_) internal view {
        require(block.chainid == chainId_, "SluiceScript: wrong chain for this script");
    }

    function _key() internal view returns (uint256) {
        return vm.envUint("PRIVATE_KEY");
    }

    function _deployer() internal view returns (address) {
        return vm.addr(_key());
    }

    function _addr(string memory file_, string memory key_) internal view returns (address) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        return vm.parseJsonAddress(vm.readFile(file_), string.concat(".", key_));
    }

    function _b32(string memory file_, string memory key_) internal view returns (bytes32) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        return vm.parseJsonBytes32(vm.readFile(file_), string.concat(".", key_));
    }

    function _save(string memory json_, string memory file_) internal {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(json_, file_);
    }
}
