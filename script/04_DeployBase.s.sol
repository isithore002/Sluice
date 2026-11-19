// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {SluiceVault} from "../src/SluiceVault.sol";
import {RelayerReserve} from "../src/RelayerReserve.sol";
import {SluiceScript, IDepositTo} from "./SluiceScript.sol";

/// @notice Step 4 (Base Sepolia): vault + relayer reserve, both trusting the reactive contract, both funded on the
///         callback proxy (callbacks are billed in Base Sepolia ETH).
contract DeployBase is SluiceScript {
    function run() external {
        _requireChain(BASE);
        address rc = _addr(REACTIVE_FILE, "sluiceReactive");
        address usd = _addr(MARKET_FILE, "mockUSD");
        MarketParams memory p = MarketParams({
            loanToken: usd,
            collateralToken: _addr(MARKET_FILE, "mockCollateral"),
            oracle: _addr(MARKET_FILE, "oracle"),
            irm: address(0),
            lltv: LLTV
        });
        uint256 fund = vm.envOr("CALLBACK_FUND_WEI", uint256(0.01 ether));
        address deployer = _deployer();

        vm.startBroadcast(_key());
        SluiceVault vault = new SluiceVault(IPayable(BASE_PROXY), rc, IMorpho(MORPHO), p, deployer);
        RelayerReserve reserve = new RelayerReserve(IPayable(BASE_PROXY), rc, IERC20(usd), vault, deployer);
        vault.setReserve(address(reserve));
        IDepositTo(BASE_PROXY).depositTo{value: fund}(address(vault));
        IDepositTo(BASE_PROXY).depositTo{value: fund}(address(reserve));
        vm.stopBroadcast();

        string memory o = "base";
        vm.serializeAddress(o, "sluiceVault", address(vault));
        _save(vm.serializeAddress(o, "relayerReserve", address(reserve)), BASE_FILE);
    }
}
