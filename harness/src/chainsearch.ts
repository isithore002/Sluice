import type { ChainClients } from "./chains.js";
import { sleep } from "./util.js";

/** Retry an idempotent RPC read: public endpoints drop the odd connection. */
export async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await sleep(400 * 2 ** i);
    }
  }
}

async function timestampOf(c: ChainClients, n: bigint): Promise<number> {
  try {
    return Number((await c.pub.getBlock({ blockNumber: n })).timestamp);
  } catch {
    return 0; // pruned or unavailable: treat as older than anything we look for
  }
}

/** The latest block whose timestamp is <= `ts` (binary search over the chain's recent history). */
export async function blockAtOrBefore(c: ChainClients, ts: number): Promise<bigint> {
  let lo = 1n;
  let hi = await retry(() => c.pub.getBlockNumber());
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if ((await timestampOf(c, mid)) <= ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/**
 * Fetch events in block windows, halving the window if the RPC rejects it, so the same code works against
 * endpoints with different getLogs limits.
 */
export async function eventsInRange<T>(
  fetchWindow: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  window = 500n,
): Promise<T[]> {
  const out: T[] = [];
  let cursor = from;
  let w = window;
  while (cursor <= to) {
    const end = cursor + w - 1n > to ? to : cursor + w - 1n;
    try {
      out.push(...(await retry(() => fetchWindow(cursor, end), 3)));
      cursor = end + 1n;
    } catch (e) {
      if (w <= 10n) throw e;
      w = w / 2n;
    }
  }
  return out;
}
