// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SiblingVault} from "../src/SiblingVault.sol";
import {SluiceScript, IDepositTo} from "./SluiceScript.sol";

/// @notice Step 5 (Unichain Sepolia): sibling vault trusting the reactive contract, funded on the callback proxy.
contract DeployUni is SluiceScript {
    function run() external {
        _requireChain(UNI);
        address rc = _addr(REACTIVE_FILE, "sluiceReactive");
        address usd = _addr(UNI_TOKEN_FILE, "mockUSD");
        uint256 buffer = vm.envOr("SAFETY_BUFFER", uint256(1_000e6));
        uint256 fund = vm.envOr("CALLBACK_FUND_WEI", uint256(0.01 ether));
        address deployer = _deployer();

        vm.startBroadcast(_key());
        SiblingVault sibling = new SiblingVault(IPayable(UNI_PROXY), rc, IERC20(usd), deployer, buffer, deployer);
        IDepositTo(UNI_PROXY).depositTo{value: fund}(address(sibling));
        vm.stopBroadcast();

        _save(vm.serializeAddress("uni", "siblingVault", address(sibling)), UNI_FILE);
    }
}
