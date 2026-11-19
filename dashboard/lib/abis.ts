import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "event Deposited(address indexed owner, uint256 assets)",
  "event WithdrawQueued(uint256 indexed requestId, address indexed owner, uint256 assets)",
  "event WithdrawPaidInstantly(address indexed owner, uint256 assets)",
  "event WithdrawSettled(uint256 indexed requestId, address indexed owner, uint256 paid, uint256 remaining, uint256 traceId)",
  "function pendingTotal() view returns (uint256)",
  "function shortfall() view returns (uint256)",
  "function queueLength() view returns (uint256)",
  "function head() view returns (uint256)",
]);

export const morphoAbi = parseAbi([
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);

export const reserveAbi = parseAbi([
  "event Fronted(uint256 indexed fillId, uint256 requested, uint256 sent, uint256 inventory, uint256 traceId)",
]);

export const siblingAbi = parseAbi([
  "event CreditCommitted(uint256 creditAvailable)",
  "event Reimbursed(uint256 indexed fillId, uint256 amount, uint256 creditAvailable, uint256 traceId)",
  "function creditAvailable() view returns (uint256)",
]);

export const reactiveAbi = parseAbi([
  "event PullRequested(uint256 indexed traceId, uint8 attempt)",
  "event FrontRequested(uint256 indexed fillId, uint256 amount, uint256 traceId, uint8 attempt)",
  "event ReimburseRequested(uint256 indexed fillId, uint256 amount, uint256 traceId, uint8 attempt)",
  "event Halted(uint256 traceId, uint256 badDebtAssets)",
  "function halted() view returns (bool)",
  "function delayBlocks() view returns (uint256)",
  "function pullPending() view returns (bool)",
  "function fillNonce() view returns (uint256)",
  "function openFills() view returns (uint256[])",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const payerAbi = parseAbi(["function debt(address) view returns (uint256)"]);
