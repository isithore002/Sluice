"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, getAbiItem, parseAbi, toEventSelector, toHex, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import { reserveAbi } from "../../lib/abis";
import { clients } from "../../lib/config";
import { morphoWriteAbi, vaultUserAbi } from "../../lib/demo";

/** Base Sepolia makes a block every 200 ms: 300 blocks a minute. */
const BLOCKS_PER_MIN = 300;
/** The public RPC refuses eth_getLogs over more than 200 blocks, so logs are read in windows of 190. */
const LOG_WINDOW = 190n;
const POLL_MS = 5000;
const WORKERS = 2;

export type Kind = "supply" | "withdraw" | "borrow" | "repay" | "deposit" | "queued" | "instant" | "settled" | "fronted";

/** One decoded on-chain event that moves cash or the queue. Nothing here is computed: it is what the logs say. */
export interface TEvent {
  id: string;
  kind: Kind;
  block: bigint;
  logIndex: number;
  tx: Hex;
  /** mUSD (6 decimals): assets moved, paid, or fronted. */
  amount: bigint;
  /** Who it is about (lender, or the Morpho position the call was on behalf of). */
  who?: Address;
  requestId?: bigint;
  remaining?: bigint;
  traceId?: bigint;
}

/** An event with its block time, and the pool's state right after it (replayed backwards from the live state). */
export interface Placed extends TEvent {
  ts: number | null;
  freeAfter: bigint;
  pendingAfter: bigint;
  waitingAfter: number;
}

export interface Reach {
  idle: bigint;
  morpho: bigint;
  reachable: bigint;
  pending: bigint;
  waiting: number;
  free: bigint;
}

/** A transaction, with every event it emitted. A deposit, for example, is a vault Deposited plus a Morpho Supply. */
export interface Row {
  tx: Hex;
  ts: number | null;
  block: bigint;
  events: Placed[];
  primary: Placed;
  /** Net change of the Morpho market's free cash across the transaction. */
  cashDelta: bigint;
  freeAfter: bigint;
  pendingAfter: bigint;
  waitingAfter: number;
}

export interface Counters {
  receivedCount: number;
  receivedAmount: bigint;
  queuedCount: number;
  instantCount: number;
  payoutCount: number;
  paidAmount: bigint;
  ticketsPaidInFull: number;
  byReactiveCount: number;
  depositsAmount: bigint;
  repaidAmount: bigint;
  frontedAmount: bigint;
  borrowedAmount: bigint;
  paidOutAmount: bigint;
  medianSettleMs: number | null;
  lastSettleMs: number | null;
  settleSamples: number;
}

export interface TreasuryData {
  status: "loading" | "ready";
  progress: { done: number; total: number };
  error: string | null;
  reach: Reach | null;
  /** Events inside the selected window, oldest first. */
  events: Placed[];
  rows: Row[];
  startFree: bigint;
  startPending: bigint;
  windowStartTs: number | null;
  nowTs: number | null;
  /** True when replaying the events backwards would need negative cash: some event is missing from the window. */
  inconsistent: boolean;
  counters: Counters;
}

const MORPHO_EVENTS = parseAbi([
  "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
]);
const vaultReachAbi = parseAbi(["function idle() view returns (uint256)", "function morphoWithdrawable() view returns (uint256)"]);

const selector = (abi: Abi, name: string) => toEventSelector(getAbiItem({ abi, name }) as AbiEvent);
const MORPHO_SELS = ["Supply", "Withdraw", "Borrow", "Repay"].map((n) => selector(MORPHO_EVENTS, n));
const VAULT_SELS = ["Deposited", "WithdrawQueued", "WithdrawPaidInstantly", "WithdrawSettled"].map((n) => selector(vaultUserAbi, n));
const FRONTED_SEL = selector(reserveAbi, "Fronted");

interface RawLog {
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  data: Hex;
  topics: [Hex, ...Hex[]];
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

function rawLogs(address: Address, from: bigint, to: bigint, topics: (Hex | Hex[])[]): Promise<RawLog[]> {
  return withRetry(
    () =>
      (clients.base as unknown as { request: (a: { method: string; params: unknown[] }) => Promise<RawLog[]> }).request({
        method: "eth_getLogs",
        params: [{ address, fromBlock: toHex(from), toBlock: toHex(to), topics }],
      }),
  );
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function base(l: RawLog, kind: Kind, amount: bigint): TEvent {
  const block = BigInt(l.blockNumber);
  const logIndex = Number(BigInt(l.logIndex));
  return { id: `${block}:${logIndex}`, kind, block, logIndex, tx: l.transactionHash, amount };
}

/** Decodes one window of logs from the market, the vault and the reserve. Unknown logs are skipped, never guessed. */
async function fetchWindow(from: bigint, to: bigint, A: Record<string, string>): Promise<TEvent[]> {
  const [m, v, r] = await Promise.all([
    rawLogs(A.morpho as Address, from, to, [MORPHO_SELS, A.marketId as Hex]),
    rawLogs(A.sluiceVault as Address, from, to, [VAULT_SELS]),
    rawLogs(A.relayerReserve as Address, from, to, [[FRONTED_SEL]]),
  ]);
  const out: TEvent[] = [];
  for (const l of m) {
    try {
      const d = decodeEventLog({ abi: MORPHO_EVENTS, data: l.data, topics: l.topics }) as { eventName: string; args: Record<string, any> };
      const kind = d.eventName.toLowerCase() as Kind;
      out.push({ ...base(l, kind, d.args.assets as bigint), who: d.args.onBehalf as Address });
    } catch {
      /* not one of ours */
    }
  }
  for (const l of v) {
    try {
      const d = decodeEventLog({ abi: vaultUserAbi, data: l.data, topics: l.topics }) as { eventName: string; args: Record<string, any> };
      const a = d.args;
      if (d.eventName === "Deposited") out.push({ ...base(l, "deposit", a.assets), who: a.owner });
      else if (d.eventName === "WithdrawQueued") out.push({ ...base(l, "queued", a.assets), who: a.owner, requestId: a.requestId });
      else if (d.eventName === "WithdrawPaidInstantly") out.push({ ...base(l, "instant", a.assets), who: a.owner });
      else if (d.eventName === "WithdrawSettled")
        out.push({ ...base(l, "settled", a.paid), who: a.owner, requestId: a.requestId, remaining: a.remaining, traceId: a.traceId });
    } catch {
      /* not one of ours */
    }
  }
  for (const l of r) {
    try {
      const d = decodeEventLog({ abi: reserveAbi, data: l.data, topics: l.topics }) as { eventName: string; args: Record<string, any> };
      if (d.eventName === "Fronted") out.push({ ...base(l, "fronted", d.args.sent), traceId: d.args.traceId });
    } catch {
      /* not one of ours */
    }
  }
  return out;
}

// ---- how each event moves the three numbers the replay tracks -------------------------------------------------------
const freeDelta = (e: TEvent) => (e.kind === "supply" || e.kind === "repay" ? e.amount : e.kind === "withdraw" || e.kind === "borrow" ? -e.amount : 0n);
const pendingDelta = (e: TEvent) => (e.kind === "queued" ? e.amount : e.kind === "settled" ? -e.amount : 0n);
const waitingDelta = (e: TEvent) => (e.kind === "queued" ? 1 : e.kind === "settled" && e.remaining === 0n ? -1 : 0);

interface Anchor {
  block: bigint;
  free: bigint;
  pending: bigint;
  waiting: number;
  idle: bigint;
  morpho: bigint;
}

interface Snapshot {
  anchor: Anchor;
  nowTs: number;
  events: TEvent[];
  ts: Map<string, number>;
}

async function readAnchor(A: Record<string, string>, block: bigint): Promise<Anchor> {
  const vault = A.sluiceVault as Address;
  const contracts = [
    { address: A.morpho as Address, abi: morphoWriteAbi, functionName: "market", args: [A.marketId as Hex] },
    { address: vault, abi: vaultUserAbi, functionName: "pendingTotal" },
    { address: vault, abi: vaultUserAbi, functionName: "queueLength" },
    { address: vault, abi: vaultUserAbi, functionName: "head" },
    { address: vault, abi: vaultReachAbi, functionName: "idle" },
    { address: vault, abi: vaultReachAbi, functionName: "morphoWithdrawable" },
  ] as const;
  const r = (await withRetry(() => clients.base.multicall({ contracts: contracts as never, allowFailure: false, blockNumber: block }))) as unknown as [
    readonly bigint[],
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  return { block, free: r[0][0] - r[0][2], pending: r[1], waiting: Number(r[2] - r[3]), idle: r[4], morpho: r[5] };
}

/** Walks the events backwards from the live state: each event's "after" is exact, and the start of the window falls out. */
function replay(all: TEvent[], anchor: Anchor, ts: Map<string, number>) {
  let free = anchor.free;
  let pending = anchor.pending;
  let waiting = anchor.waiting;
  const placed: Placed[] = new Array(all.length);
  let inconsistent = false;
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    placed[i] = { ...e, ts: ts.get(e.block.toString()) ?? null, freeAfter: free, pendingAfter: pending, waitingAfter: waiting };
    free -= freeDelta(e);
    pending -= pendingDelta(e);
    waiting -= waitingDelta(e);
    if (free < 0n || pending < 0n || waiting < 0) inconsistent = true;
  }
  return { placed, inconsistent };
}

const PRIORITY: Kind[] = ["settled", "instant", "queued", "deposit", "repay", "borrow", "fronted", "withdraw", "supply"];

export function groupRows(events: Placed[]): Row[] {
  const rows: Row[] = [];
  for (const e of events) {
    const last = rows[rows.length - 1];
    if (last && last.tx === e.tx) {
      last.events.push(e);
      last.cashDelta += freeDelta(e);
      last.freeAfter = e.freeAfter;
      last.pendingAfter = e.pendingAfter;
      last.waitingAfter = e.waitingAfter;
    } else {
      rows.push({ tx: e.tx, ts: e.ts, block: e.block, events: [e], primary: e, cashDelta: freeDelta(e), freeAfter: e.freeAfter, pendingAfter: e.pendingAfter, waitingAfter: e.waitingAfter });
    }
  }
  for (const r of rows) r.primary = [...r.events].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
  return rows;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function countersFor(ev: Placed[]): Counters {
  const c: Counters = {
    receivedCount: 0, receivedAmount: 0n, queuedCount: 0, instantCount: 0, payoutCount: 0, paidAmount: 0n, ticketsPaidInFull: 0, byReactiveCount: 0,
    depositsAmount: 0n, repaidAmount: 0n, frontedAmount: 0n, borrowedAmount: 0n, paidOutAmount: 0n, medianSettleMs: null, lastSettleMs: null, settleSamples: 0,
  };
  const queuedAt = new Map<string, number>();
  const samples: { at: number; ms: number }[] = [];
  for (const e of ev) {
    switch (e.kind) {
      case "queued":
        c.receivedCount++; c.queuedCount++; c.receivedAmount += e.amount;
        if (e.ts !== null && e.requestId !== undefined) queuedAt.set(e.requestId.toString(), e.ts);
        break;
      case "instant":
        c.receivedCount++; c.instantCount++; c.receivedAmount += e.amount; c.paidOutAmount += e.amount;
        break;
      case "settled": {
        c.payoutCount++; c.paidAmount += e.amount; c.paidOutAmount += e.amount;
        if (e.traceId !== undefined && e.traceId !== 0n) c.byReactiveCount++;
        if (e.remaining === 0n) {
          c.ticketsPaidInFull++;
          const q = e.requestId !== undefined ? queuedAt.get(e.requestId.toString()) : undefined;
          if (q !== undefined && e.ts !== null) samples.push({ at: e.ts, ms: Math.max(0, e.ts - q) * 1000 });
        }
        break;
      }
      case "deposit": c.depositsAmount += e.amount; break;
      case "repay": c.repaidAmount += e.amount; break;
      case "fronted": c.frontedAmount += e.amount; break;
      case "borrow": c.borrowedAmount += e.amount; break;
      default: break;
    }
  }
  c.settleSamples = samples.length;
  c.medianSettleMs = median(samples.map((s) => s.ms));
  c.lastSettleMs = samples.length ? samples[samples.length - 1].ms : null;
  return c;
}

/**
 * The treasury's real history. It reads the Morpho market's Supply / Withdraw / Borrow / Repay events and the vault's
 * and reserve's events for the chosen window (only the part not already loaded), then replays them BACKWARDS from the
 * live state read at the same block, so the line ends exactly at today's free cash. Block times are the chain's own.
 */
export function useTreasury(addresses: Record<string, string> | null, windowMin: number): TreasuryData {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const events = useRef(new Map<string, TEvent>());
  const ts = useRef(new Map<string, number>());
  const covered = useRef<{ from: bigint; to: bigint } | null>(null);
  const want = useRef(windowMin);
  const running = useRef(false);
  const again = useRef(false);
  const kick = useRef<() => void>(() => {});
  const failures = useRef(0);
  want.current = windowMin;

  useEffect(() => {
    if (!addresses) return;
    const A = addresses;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        const latest = await withRetry(() => clients.base.getBlockNumber());
        const start = latest > BigInt(want.current * BLOCKS_PER_MIN) ? latest - BigInt(want.current * BLOCKS_PER_MIN) : 0n;

        // Only what isn't loaded yet: older blocks if the window grew, newer blocks since the last poll.
        const ranges: [bigint, bigint][] = [];
        const cov = covered.current;
        if (!cov) ranges.push([start, latest]);
        else {
          if (start < cov.from) ranges.push([start, cov.from - 1n]);
          if (latest > cov.to) ranges.push([cov.to + 1n, latest]);
        }
        const wins: [bigint, bigint][] = [];
        for (const [a, b] of ranges) for (let f = a; f <= b; f += LOG_WINDOW) wins.push([f, f + LOG_WINDOW - 1n > b ? b : f + LOG_WINDOW - 1n]);
        setProgress({ done: 0, total: wins.length });

        let done = 0;
        const fresh: TEvent[] = [];
        const [anchor, latestBlock] = await Promise.all([
          readAnchor(A, latest),
          withRetry(() => clients.base.getBlock({ blockNumber: latest })),
          pool(wins, WORKERS, async ([f, t]) => {
            fresh.push(...(await fetchWindow(f, t, A)));
            if (!stopped) setProgress({ done: ++done, total: wins.length });
          }),
        ]);
        if (stopped) return;

        for (const e of fresh) events.current.set(e.id, e);
        covered.current = { from: cov ? (start < cov.from ? start : cov.from) : start, to: latest };
        ts.current.set(latest.toString(), Number(latestBlock.timestamp));

        // Block times for the blocks that hold events (the chain's own timestamps; nothing is interpolated).
        const need = [...new Set(fresh.map((e) => e.block.toString()))].filter((b) => !ts.current.has(b));
        await pool(need, 4, async (b) => {
          try {
            const blk = await withRetry(() => clients.base.getBlock({ blockNumber: BigInt(b) }));
            ts.current.set(b, Number(blk.timestamp));
          } catch {
            /* this event keeps an unknown time */
          }
        });
        if (stopped) return;

        const sorted = [...events.current.values()].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
        setSnap({ anchor: { ...anchor }, nowTs: Number(latestBlock.timestamp), events: sorted, ts: new Map(ts.current) });
        failures.current = 0;
        setError(null);
      } catch (e) {
        failures.current++;
        if (failures.current >= 2) setError(`Could not read Base Sepolia: ${((e as Error)?.message ?? String(e)).split("\n")[0]}. Showing what was loaded; retrying.`);
      } finally {
        running.current = false;
        if (again.current && !stopped) {
          again.current = false;
          void refresh();
        }
      }
    }

    kick.current = () => void refresh();
    async function loop() {
      if (stopped) return;
      if (typeof document === "undefined" || !document.hidden) await refresh();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    }
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [addresses]);

  // A larger window loads the earlier blocks right away instead of waiting for the next poll.
  const prevWindow = useRef(windowMin);
  useEffect(() => {
    if (prevWindow.current !== windowMin) {
      prevWindow.current = windowMin;
      kick.current();
    }
  }, [windowMin]);

  const reachNow = useCallback((s: Snapshot): Reach => ({ idle: s.anchor.idle, morpho: s.anchor.morpho, reachable: s.anchor.idle + s.anchor.morpho, pending: s.anchor.pending, waiting: s.anchor.waiting, free: s.anchor.free }), []);

  return useMemo<TreasuryData>(() => {
    const empty: Counters = countersFor([]);
    if (!snap) return { status: "loading", progress, error, reach: null, events: [], rows: [], startFree: 0n, startPending: 0n, windowStartTs: null, nowTs: null, inconsistent: false, counters: empty };
    const { placed, inconsistent } = replay(snap.events, snap.anchor, snap.ts);
    const startBlock = snap.anchor.block - BigInt(windowMin * BLOCKS_PER_MIN);
    const i0 = placed.findIndex((e) => e.block >= startBlock);
    const inWindow = i0 === -1 ? [] : placed.slice(i0);
    // The state just before the window's first event (or the live state when nothing happened).
    const first = inWindow[0];
    const startFree = first ? first.freeAfter - freeDelta(first) : snap.anchor.free;
    const startPending = first ? first.pendingAfter - pendingDelta(first) : snap.anchor.pending;
    return {
      status: "ready",
      progress,
      error,
      reach: reachNow(snap),
      events: inWindow,
      rows: groupRows(inWindow),
      startFree,
      startPending,
      windowStartTs: snap.nowTs - windowMin * 60,
      nowTs: snap.nowTs,
      inconsistent,
      counters: countersFor(inWindow),
    };
  }, [snap, windowMin, progress, error, reachNow]);
}

// ---- who sent a transaction (so a payout can be tagged "sent by Reactive's signer"), looked up once per hash --------
const senders = new Map<string, string | null>();

export function useSenders(hashes: Hex[]): Map<string, string | null> {
  const [, bump] = useState(0);
  const key = hashes.join(",");
  useEffect(() => {
    let live = true;
    const missing = hashes.filter((h) => !senders.has(h));
    if (!missing.length) return;
    void pool(missing, 3, async (h) => {
      try {
        const tx = await withRetry(() => clients.base.getTransaction({ hash: h }), 3);
        senders.set(h, tx.from);
      } catch {
        senders.set(h, null);
      }
    }).then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return senders;
}
