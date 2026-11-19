// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {OneClickRepay} from "../src/demo/OneClickRepay.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 9 (Base Sepolia, optional): the one-click helper the dashboard's "Try it" panel calls.
///         The demo borrower is the deployer (step 7 borrows from this wallet), so that is whose debt it repays.
contract DeployOneClick is SluiceScript {
    string internal constant TRYIT_FILE = "deployments/base-tryit.json";

    function run() external {
        _requireChain(BASE);
        MarketParams memory p = MarketParams({
            loanToken: _addr(MARKET_FILE, "mockUSD"),
            collateralToken: _addr(MARKET_FILE, "mockCollateral"),
            oracle: _addr(MARKET_FILE, "oracle"),
            irm: address(0),
            lltv: LLTV
        });
        uint256 amount = vm.envOr("ONE_CLICK_AMOUNT", uint256(10e6));

        vm.startBroadcast(_key());
        OneClickRepay one = new OneClickRepay(IMorpho(MORPHO), p, _deployer(), amount);
        vm.stopBroadcast();

        _save(vm.serializeAddress("tryit", "oneClickRepay", address(one)), TRYIT_FILE);
    }
}
