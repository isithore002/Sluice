// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";
import {MockCollateral} from "../src/mocks/MockCollateral.sol";
import {FixedOracle} from "../src/mocks/FixedOracle.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 1 (Base Sepolia): mock tokens, fixed oracle, and our isolated Morpho Blue market.
contract DeployMarket is SluiceScript {
    using MarketParamsLib for MarketParams;

    function run() external {
        _requireChain(BASE);
        vm.startBroadcast(_key());
        MockUSD usd = new MockUSD();
        MockCollateral col = new MockCollateral();
        FixedOracle oracle = new FixedOracle(ORACLE_PRICE);
        MarketParams memory p = MarketParams({
            loanToken: address(usd), collateralToken: address(col), oracle: address(oracle), irm: address(0), lltv: LLTV
        });
        IMorpho(MORPHO).createMarket(p);
        vm.stopBroadcast();

        string memory o = "market";
        vm.serializeAddress(o, "morpho", MORPHO);
        vm.serializeAddress(o, "mockUSD", address(usd));
        vm.serializeAddress(o, "mockCollateral", address(col));
        vm.serializeAddress(o, "oracle", address(oracle));
        vm.serializeUint(o, "lltv", LLTV);
        _save(vm.serializeBytes32(o, "marketId", Id.unwrap(p.id())), MARKET_FILE);
    }
}
