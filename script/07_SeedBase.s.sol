// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IMorpho, MarketParams, Market} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";
import {MockCollateral} from "../src/mocks/MockCollateral.sol";
import {SluiceVault} from "../src/SluiceVault.sol";
import {RelayerReserve} from "../src/RelayerReserve.sol";
import {SluiceScript} from "./SluiceScript.sol";

/// @notice Step 7 (Base Sepolia): seed the demo.
///         - the deployer deposits into the vault (supplied to Morpho);
///         - the deployer also supplies to Morpho directly, as the "competitor" lender for the latency race;
///         - the relayer (deployer) funds the reserve;
///         - the borrower (deployer) borrows every unit of liquidity: the market is at 100% utilization.
contract SeedBase is SluiceScript {
    using MarketParamsLib for MarketParams;

    function run() external {
        _requireChain(BASE);
        MockUSD usd = MockUSD(_addr(MARKET_FILE, "mockUSD"));
        MockCollateral col = MockCollateral(_addr(MARKET_FILE, "mockCollateral"));
        SluiceVault vault = SluiceVault(payable(_addr(BASE_FILE, "sluiceVault")));
        RelayerReserve reserve = RelayerReserve(payable(_addr(BASE_FILE, "relayerReserve")));
        MarketParams memory p = vault.marketParams();
        IMorpho morpho = IMorpho(MORPHO);

        uint256 vaultDeposit = vm.envOr("SEED_VAULT_DEPOSIT", uint256(5_000e6));
        uint256 competitorSupply = vm.envOr("SEED_COMPETITOR_SUPPLY", uint256(5_000e6));
        uint256 reserveInventory = vm.envOr("SEED_RESERVE_INVENTORY", uint256(2_000e6));
        address me = _deployer();

        vm.startBroadcast(_key());
        usd.mint(me, vaultDeposit + competitorSupply + reserveInventory);
        usd.approve(address(vault), type(uint256).max);
        usd.approve(address(morpho), type(uint256).max);
        usd.approve(address(reserve), type(uint256).max);
        col.approve(address(morpho), type(uint256).max);

        vault.deposit(vaultDeposit);
        morpho.supply(p, competitorSupply, 0, me, "");
        reserve.fund(reserveInventory);

        Market memory m = morpho.market(p.id());
        uint256 liquidity = m.totalSupplyAssets - m.totalBorrowAssets;
        uint256 collateral = liquidity * 4e12; // 4x over-collateralized: room for many race rounds
        col.mint(me, collateral);
        morpho.supplyCollateral(p, collateral, me, "");
        morpho.borrow(p, liquidity, 0, me, me);
        vm.stopBroadcast();
    }
}
