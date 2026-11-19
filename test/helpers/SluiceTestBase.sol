// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ReactiveTest} from "reactive-test-lib/ReactiveTest.sol";
import {IMorpho, MarketParams, Market, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MockUSD} from "../../src/mocks/MockUSD.sol";
import {MockCollateral} from "../../src/mocks/MockCollateral.sol";
import {FixedOracle} from "../../src/mocks/FixedOracle.sol";

/// @notice Shared setup. Runs the REAL Morpho Blue bytecode (captured from Base Sepolia into
///         test/fixtures/morpho-blue-runtime.hex) at its real address, and makes the test contract its owner so
///         it can enable the zero-rate IRM and the 86% LLTV, exactly as they are enabled on Base Sepolia.
abstract contract SluiceTestBase is ReactiveTest {
    using MarketParamsLib for MarketParams;

    uint256 internal constant LASNA = 5318007;
    uint256 internal constant BASE = 84532;
    uint256 internal constant UNI = 1301;

    address internal constant MORPHO_ADDR = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    uint256 internal constant LLTV = 0.86e18;
    /// @dev 1 collateral (18 decimals) = 1 MockUSD (6 decimals) at Morpho's 1e36 scale.
    uint256 internal constant ORACLE_PRICE = 1e24;

    IMorpho internal morpho = IMorpho(MORPHO_ADDR);
    MockUSD internal usd;
    MockCollateral internal col;
    FixedOracle internal oracle;
    MarketParams internal params;
    Id internal marketId;

    address internal borrower = makeAddr("borrower");

    function _setUpMorphoMarket() internal {
        // Read-only access to our own fixture (fs_permissions limits it to ./test/fixtures).
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory hexCode = vm.trim(vm.readFile("test/fixtures/morpho-blue-runtime.hex"));
        vm.etch(MORPHO_ADDR, vm.parseBytes(hexCode));
        // Slot 0 is `owner` (verified on Base Sepolia with `cast storage`).
        vm.store(MORPHO_ADDR, bytes32(0), bytes32(uint256(uint160(address(this)))));
        morpho.enableIrm(address(0));
        morpho.enableLltv(LLTV);

        usd = new MockUSD();
        col = new MockCollateral();
        oracle = new FixedOracle(ORACLE_PRICE);
        params = MarketParams({
            loanToken: address(usd), collateralToken: address(col), oracle: address(oracle), irm: address(0), lltv: LLTV
        });
        morpho.createMarket(params);
        marketId = params.id();
    }

    /// @dev The borrower borrows every unit of free liquidity: the market is at 100% utilization.
    function _borrowAll() internal returns (uint256 borrowed_) {
        Market memory m = morpho.market(marketId);
        borrowed_ = m.totalSupplyAssets - m.totalBorrowAssets;
        if (borrowed_ == 0) return 0;
        uint256 collateral = borrowed_ * 2e12; // 2x over-collateralized
        col.mint(borrower, collateral);
        vm.startPrank(borrower);
        col.approve(MORPHO_ADDR, type(uint256).max);
        usd.approve(MORPHO_ADDR, type(uint256).max);
        morpho.supplyCollateral(params, collateral, borrower, "");
        morpho.borrow(params, borrowed_, 0, borrower, borrower);
        vm.stopPrank();
    }

    function _repay(uint256 assets_) internal {
        vm.prank(borrower);
        morpho.repay(params, assets_, 0, borrower, "");
    }

    function _liquidity() internal view returns (uint256) {
        Market memory m = morpho.market(marketId);
        return m.totalSupplyAssets - m.totalBorrowAssets;
    }
}
