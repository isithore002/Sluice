import { parseAbi, type Address, type Hex } from "viem";
import { account, base, rnk, uni } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import { read, send, type Sent } from "./util.js";

export const me: Address = account.address;

const PAYER_ABI = parseAbi([
  "function reserves(address) view returns (uint256)",
  "function debt(address) view returns (uint256)",
]);

export interface MarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

let cachedParams: MarketParams | null = null;
export async function marketParams(): Promise<MarketParams> {
  if (!cachedParams) cachedParams = await read<MarketParams>(base, ADDR.vault, ABI.vault, "marketParams");
  return cachedParams;
}

// ----- reads -------------------------------------------------------------------------------------------------

export async function market() {
  return read<{ totalSupplyAssets: bigint; totalBorrowAssets: bigint }>(base, ADDR.morpho, ABI.morpho, "market", [
    ADDR.marketId,
  ]);
}

export async function liquidity(): Promise<bigint> {
  const m = await market();
  return m.totalSupplyAssets - m.totalBorrowAssets;
}

export const pending = () => read<bigint>(base, ADDR.vault, ABI.vault, "pendingTotal");
export const shortfall = () => read<bigint>(base, ADDR.vault, ABI.vault, "shortfall");
export const myShares = () => read<bigint>(base, ADDR.vault, ABI.vault, "sharesOf", [me]);
export const inventory = () => read<bigint>(base, ADDR.usd, ABI.usd, "balanceOf", [ADDR.reserve]);
export const credit = () => read<bigint>(uni, ADDR.sibling, ABI.sibling, "creditAvailable");
export const halted = () => read<boolean>(rnk, ADDR.reactive, ABI.reactive, "halted");
export const delayBlocks = () => read<bigint>(rnk, ADDR.reactive, ABI.reactive, "delayBlocks");

export async function competitorSupply(): Promise<bigint> {
  const pos = await read<{ supplyShares: bigint }>(base, ADDR.morpho, ABI.morpho, "position", [ADDR.marketId, me]);
  const m = await read<{ totalSupplyAssets: bigint; totalSupplyShares: bigint }>(base, ADDR.morpho, ABI.morpho, "market", [
    ADDR.marketId,
  ]);
  // Morpho SharesMathLib.toAssetsDown with virtual shares 1e6 and virtual assets 1.
  return (pos.supplyShares * (m.totalSupplyAssets + 1n)) / (m.totalSupplyShares + 1_000_000n);
}

export async function payerState(c: typeof base, payer: Address, provider: Address) {
  const [reserves, debt] = await Promise.all([
    c.pub.readContract({ address: provider, abi: PAYER_ABI, functionName: "reserves", args: [payer] }),
    c.pub.readContract({ address: provider, abi: PAYER_ABI, functionName: "debt", args: [payer] }),
  ]);
  return { reserves, debt };
}

// ----- Base writes -------------------------------------------------------------------------------------------

export const requestWithdraw = (x: bigint) => send(base, ADDR.vault, ABI.vault, "requestWithdraw", [x]);
export const deposit = (x: bigint) => send(base, ADDR.vault, ABI.vault, "deposit", [x]);
export const mintUsd = (x: bigint) => send(base, ADDR.usd, ABI.usd, "mint", [me, x]);
export const fundReserve = (x: bigint) => send(base, ADDR.reserve, ABI.reserve, "fund", [x]);

export async function repay(x: bigint): Promise<Sent> {
  return send(base, ADDR.morpho, ABI.morpho, "repay", [await marketParams(), x, 0n, me, "0x"]);
}

export async function borrow(x: bigint): Promise<Sent> {
  return send(base, ADDR.morpho, ABI.morpho, "borrow", [await marketParams(), x, 0n, me, me]);
}

/** The race competitor: a lender withdrawing its own supply from the same market. */
export async function competitorWithdraw(x: bigint): Promise<Sent> {
  return send(base, ADDR.morpho, ABI.morpho, "withdraw", [await marketParams(), x, 0n, me, me]);
}

export interface FastWithdraw {
  hash: Hex;
  ok: boolean;
  blockNumber: bigint;
}

/**
 * The race competitor, built to be as fast as a real bot: it does not read the market first and does not estimate
 * gas (a fixed gas limit skips estimation), so it fires immediately. If Sluice already took the liquidity the
 * withdrawal reverts on-chain and `ok` is false: the competitor lost the race. Any other failure throws.
 */
export async function competitorWithdrawFast(x: bigint): Promise<FastWithdraw> {
  const params = await marketParams(); // cached after the first call, so it adds no latency in a round
  const hash = await base.wallet.writeContract({
    address: ADDR.morpho,
    abi: ABI.morpho,
    functionName: "withdraw",
    args: [params, x, 0n, me, me],
    gas: 400_000n,
  } as never);
  const receipt = await base.pub.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 60_000 });
  return { hash, ok: receipt.status === "success", blockNumber: receipt.blockNumber };
}

export async function competitorSupplyMore(x: bigint): Promise<Sent> {
  return send(base, ADDR.morpho, ABI.morpho, "supply", [await marketParams(), x, 0n, me, "0x"]);
}

// ----- Unichain writes ---------------------------------------------------------------------------------------

export const mintUniUsd = (x: bigint) => send(uni, ADDR.uniUsd, ABI.usd, "mint", [me, x]);
export const siblingDeposit = (x: bigint) => send(uni, ADDR.sibling, ABI.sibling, "deposit", [x]);
export const commitCredit = () => send(uni, ADDR.sibling, ABI.sibling, "commitCredit");

// ----- Lasna (owner) writes ----------------------------------------------------------------------------------

export const setDelayBlocks = (n: bigint) => send(rnk, ADDR.reactive, ABI.reactive, "setDelayBlocks", [n]);
export const halt = () => send(rnk, ADDR.reactive, ABI.reactive, "halt");
export const resume = () => send(rnk, ADDR.reactive, ABI.reactive, "resume");

// ----- normalization ------------------------------------------------------------------------------------------

/** Bring the system to "nobody queued, market at 100% utilization". */
export async function normalize(log: (s: string) => void = () => {}): Promise<void> {
  const p = await pending();
  if (p > 0n) {
    log(`  normalize: ${p} still queued, depositing to clear it`);
    await mintUsd(p);
    await deposit(p); // a deposit pays the queue in the same transaction
  }
  const l = await liquidity();
  if (l > 0n) {
    log(`  normalize: borrowing ${l} free liquidity`);
    await borrow(l);
  }
}

/** Set the cross-chain switch and delay mode, sending Lasna transactions only when something changes. */
export async function setMode(opts: { crossChain: boolean; delay: bigint }, log: (s: string) => void = () => {}) {
  const isHalted = await halted();
  if (opts.crossChain && isHalted) {
    log("  resume cross-chain fronting");
    await resume();
  }
  if (!opts.crossChain && !isHalted) {
    log("  halt cross-chain fronting (isolate the Morpho path)");
    await halt();
  }
  if ((await delayBlocks()) !== opts.delay) {
    log(`  set delayBlocks = ${opts.delay}`);
    await setDelayBlocks(opts.delay);
  }
}
