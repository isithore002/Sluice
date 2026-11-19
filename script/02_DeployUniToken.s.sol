// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {MockUSD} from "../src/mocks/MockUSD.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 2 (Unichain Sepolia): the sibling vault's MockUSD.
contract DeployUniToken is SluiceScript {
    function run() external {
        _requireChain(UNI);
        vm.startBroadcast(_key());
        MockUSD usd = new MockUSD();
        vm.stopBroadcast();

        _save(vm.serializeAddress("uniToken", "mockUSD", address(usd)), UNI_TOKEN_FILE);
    }
}
