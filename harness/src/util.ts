import type { Abi, Address, Hex, Log } from "viem";
import type { ChainClients } from "./chains.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1 MockUSD = 1e6 units. */
export const usdUnits = (x: number) => BigInt(Math.round(x * 1e6));
export const fmtUsd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface Sent {
  hash: Hex;
  sentAt: number;
  /** Wall-clock ms when the harness observed the receipt. */
  seenAt: number;
  blockNumber: bigint;
}

/** Send a contract write and wait for a successful receipt. */
export async function send(
  c: ChainClients,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  value?: bigint,
): Promise<Sent> {
  const sentAt = Date.now();
  const hash = await c.wallet.writeContract({ address, abi, functionName, args, value } as never);
  const receipt = await c.pub.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 120_000 });
  const seenAt = Date.now();
  if (receipt.status !== "success") throw new Error(`${c.name} ${functionName} reverted: ${hash}`);
  return { hash, sentAt, seenAt, blockNumber: receipt.blockNumber };
}

export async function read<T>(c: ChainClients, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  return (await c.pub.readContract({ address, abi, functionName, args } as never)) as T;
}

export interface Seen {
  log: Log & { args: Record<string, unknown>; eventName: string };
  seenAt: number;
}

/**
 * Poll for the first event matching `match`, from `fromBlock`. Returns null on timeout.
 * Wall-clock observation adds up to one poll interval of error, so pollMs is small.
 */
export async function waitForEvent(opts: {
  c: ChainClients;
  address: Address;
  abi: Abi;
  eventName: string;
  fromBlock: bigint;
  args?: Record<string, unknown>;
  match?: (args: Record<string, unknown>) => boolean;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<Seen | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let pollMs = opts.pollMs ?? 150;
  while (Date.now() < deadline) {
    try {
      const logs = (await opts.c.pub.getContractEvents({
        address: opts.address,
        abi: opts.abi,
        eventName: opts.eventName,
        args: opts.args,
        fromBlock: opts.fromBlock,
        toBlock: "latest",
      } as never)) as unknown as Seen["log"][];
      const hit = logs.find((l) => (opts.match ? opts.match(l.args) : true));
      if (hit) return { log: hit, seenAt: Date.now() };
      pollMs = opts.pollMs ?? 150;
    } catch {
      pollMs = Math.min(pollMs * 2, 2_000); // back off on rate limits
    }
    await sleep(pollMs);
  }
  return null;
}

/** All matching events (e.g. every WithdrawSettled carrying one trace). */
export async function allEvents(opts: {
  c: ChainClients;
  address: Address;
  abi: Abi;
  eventName: string;
  fromBlock: bigint;
  match?: (args: Record<string, unknown>) => boolean;
}): Promise<Seen["log"][]> {
  const logs = (await opts.c.pub.getContractEvents({
    address: opts.address,
    abi: opts.abi,
    eventName: opts.eventName,
    fromBlock: opts.fromBlock,
    toBlock: "latest",
  } as never)) as unknown as Seen["log"][];
  return logs.filter((l) => (opts.match ? opts.match(l.args) : true));
}

export async function blockTime(c: ChainClients, blockNumber: bigint | null | undefined): Promise<number | null> {
  if (blockNumber === null || blockNumber === undefined) return null;
  const b = await c.pub.getBlock({ blockNumber });
  return Number(b.timestamp);
}

export function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  return { n: s.length, min: s[0] ?? NaN, median: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? NaN, mean };
}
