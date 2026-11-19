// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {SluiceReactive} from "../src/SluiceReactive.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 6 (Reactive Lasna): subscribe the reactive contract to the vault, Morpho (our market only), the
///         reserve and the sibling vault. Runs before seeding, so the seed's events populate its caches.
contract Configure is SluiceScript {
    function run() external {
        _requireChain(LASNA);
        SluiceReactive rc = SluiceReactive(payable(_addr(REACTIVE_FILE, "sluiceReactive")));
        address vault = _addr(BASE_FILE, "sluiceVault");
        address reserve = _addr(BASE_FILE, "relayerReserve");
        address sibling = _addr(UNI_FILE, "siblingVault");
        bytes32 marketId = _b32(MARKET_FILE, "marketId");

        vm.startBroadcast(_key());
        rc.configure(vault, reserve, sibling, MORPHO, marketId);
        vm.stopBroadcast();
    }
}
