// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {MockUSD} from "../src/mocks/MockUSD.sol";
import {SiblingVault} from "../src/SiblingVault.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 8 (Unichain Sepolia): deposit into the sibling vault and commit everything above the safety
///         buffer as cross-chain credit.
contract SeedUni is SluiceScript {
    function run() external {
        _requireChain(UNI);
        MockUSD usd = MockUSD(_addr(UNI_TOKEN_FILE, "mockUSD"));
        SiblingVault sibling = SiblingVault(payable(_addr(UNI_FILE, "siblingVault")));
        uint256 deposit = vm.envOr("SEED_SIBLING_DEPOSIT", uint256(3_000e6));
        address me = _deployer();

        vm.startBroadcast(_key());
        usd.mint(me, deposit);
        usd.approve(address(sibling), type(uint256).max);
        sibling.deposit(deposit);
        sibling.commitCredit();
        vm.stopBroadcast();
    }
}
