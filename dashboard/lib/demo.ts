import { parseAbi, type Address, type Hex } from "viem";

/** Constants of our demo Morpho market (script/SluiceScript.sol): 86% LLTV, and 1 collateral token (18 dec) = 1 mUSD (6 dec). */
export const LLTV = 860_000_000_000_000_000n;
export const ORACLE_PRICE = 10n ** 24n;
/** Raw collateral units per raw mUSD unit at that price (1e18 collateral = 1e6 mUSD). */
export const COLLATERAL_PER_USD = 10n ** 12n;

const MARKET_PARAMS = "(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";

/** Calls a borrower makes straight on Morpho. Sluice is not involved in any of them. */
export const morphoWriteAbi = parseAbi([
  `function supplyCollateral(${MARKET_PARAMS} marketParams, uint256 assets, address onBehalf, bytes data)`,
  `function borrow(${MARKET_PARAMS} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)`,
  `function repay(${MARKET_PARAMS} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)`,
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);

/** The demo tokens are open-mint test tokens: anyone can mint themselves some. */
export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** What a lender does on the Sluice vault, plus the queue reads the pool view uses. */
export const vaultUserAbi = parseAbi([
  "event Deposited(address indexed owner, uint256 assets)",
  "event WithdrawQueued(uint256 indexed requestId, address indexed owner, uint256 assets)",
  "event WithdrawPaidInstantly(address indexed owner, uint256 assets)",
  "event WithdrawSettled(uint256 indexed requestId, address indexed owner, uint256 paid, uint256 remaining, uint256 traceId)",
  "function deposit(uint256 assets)",
  "function requestWithdraw(uint256 assets) returns (bool queued, uint256 requestId)",
  "function sharesOf(address owner) view returns (uint256)",
  "function request(uint256 requestId) view returns (address owner, uint256 remaining)",
  "function queueLength() view returns (uint256)",
  "function head() view returns (uint256)",
  "function pendingTotal() view returns (uint256)",
]);

export interface MarketParamsArg {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** The market's parameters, built from the deployment record (irm is the zero address: this market charges no interest). */
export function marketParams(a: Record<string, string>): MarketParamsArg {
  return {
    loanToken: a.mockUSD as Address,
    collateralToken: a.mockCollateral as Address,
    oracle: a.oracle as Address,
    irm: ZERO_ADDRESS,
    lltv: LLTV,
  };
}

/** Most mUSD a position can borrow against `collateral` raw units, at the oracle price and the LLTV. */
export function maxBorrowFor(collateral: bigint): bigint {
  return (collateral * ORACLE_PRICE * LLTV) / (10n ** 36n * 10n ** 18n);
}

/** Collateral (raw units) needed to borrow `usd` raw mUSD, rounded up with a 2% margin. */
export function collateralFor(usd: bigint): bigint {
  const exact = (usd * COLLATERAL_PER_USD * 10n ** 18n + LLTV - 1n) / LLTV;
  return (exact * 102n) / 100n;
}

/** A borrower's debt in mUSD, Morpho's way (shares rounded up against virtual shares and assets). */
export function debtAssets(borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint): bigint {
  const VIRTUAL_SHARES = 1_000_000n;
  const num = borrowShares * (totalBorrowAssets + 1n);
  const den = totalBorrowShares + VIRTUAL_SHARES;
  return (num + den - 1n) / den;
}

export type { Address, Hex };
