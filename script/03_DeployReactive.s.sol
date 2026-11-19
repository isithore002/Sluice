// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {SluiceReactive} from "../src/SluiceReactive.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 3 (Reactive Lasna): the reactive contract, funded with lREACT. Deployed BEFORE the callback
///         contracts, because they store its address immutably.
contract DeployReactive is SluiceScript {
    function run() external {
        _requireChain(LASNA);
        uint256 fund = vm.envOr("REACTIVE_FUND_WEI", uint256(5 ether));
        vm.startBroadcast(_key());
        SluiceReactive rc = new SluiceReactive{value: fund}(BASE, UNI);
        vm.stopBroadcast();

        _save(vm.serializeAddress("reactive", "sluiceReactive", address(rc)), REACTIVE_FILE);
    }
}
