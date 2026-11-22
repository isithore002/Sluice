"use client";

import { useEffect, useRef, useState } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { erc20Abi, morphoAbi, payerAbi, reactiveAbi, reserveAbi, siblingAbi, vaultAbi } from "./abis";
import { CHAINS, PROXIES, clients, type ChainKey } from "./config";

export interface LiveState {
  supply: bigint;
  borrow: bigint;
  pending: bigint;
  shortfall: bigint;
  queued: bigint;
  inventory: bigint;
  credit: bigint;
  halted: boolean;
  delayBlocks: bigint;
  pullPending: boolean;
  fillsOpened: bigint;
  fillsOpen: number;
  debts: { vault: bigint; reserve: bigint; sibling: bigint; reactive: bigint };
}

export interface FeedEvent {
  id: string;
  chain: ChainKey;
  name: string;
  text: string;
  tx: Hex;
  block: bigint;
  time: number | null;
  /** Who sent the transaction that emitted this event (so callbacks show as sent by Reactive's signer). */
  from: string | null;
}

const POLL_MS = 4000;
/**
 * Public RPCs time out or return an odd error now and then. Each chain is read on its own, a chain that fails keeps
 * its last values, and it is reported only after failing this many polls in a row (about 12 s).
 */
const FAILS_BEFORE_ERROR = 3;
const FEED_MAX = 40;

type BasePart = Pick<LiveState, "supply" | "borrow" | "pending" | "shortfall" | "queued" | "inventory"> & {
  debtVault: bigint;
  debtReserve: bigint;
};
type UniPart = { credit: bigint; debtSibling: bigint };
type LasnaPart = Pick<LiveState, "halted" | "delayBlocks" | "pullPending" | "fillsOpened" | "fillsOpen"> & { debtReactive: bigint };

function reasonText(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return (err?.shortMessage || err?.message || String(e)).split("\n")[0];
}
/** Base Sepolia's public RPC rejects eth_getLogs over more than 200 blocks, so logs are fetched in chunks. */
const MAX_RANGE = 150n;
const MAX_CHUNKS = 6;

async function getLogsChunked(c: PublicClient, params: Record<string, unknown>, from: bigint, to: bigint) {
  const out: any[] = [];
  let hi = to;
  for (let i = 0; i < MAX_CHUNKS && hi >= from; i++) {
    const lo = hi - MAX_RANGE + 1n > from ? hi - MAX_RANGE + 1n : from;
    out.push(...((await c.getLogs({ ...params, fromBlock: lo, toBlock: hi } as never)) as any[]));
    hi = lo - 1n;
  }
  return out;
}
const usd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

function describe(name: string, a: Record<string, any>): string {
  switch (name) {
    case "Repay":
      return `Borrower repaid ${usd(a.assets)} mUSD in the Morpho market`;
    case "Deposited":
      return `Deposit of ${usd(a.assets)} mUSD`;
    case "WithdrawQueued":
      return `Withdrawal #${a.requestId} queued: ${usd(a.assets)} mUSD`;
    case "WithdrawPaidInstantly":
      return `Withdrawal paid instantly: ${usd(a.assets)} mUSD`;
    case "WithdrawSettled":
      return `Queue paid ${usd(a.paid)} mUSD to #${a.requestId}${a.remaining > 0n ? ` (${usd(a.remaining)} still owed)` : ""}`;
    case "Fronted":
      return `Reserve fronted ${usd(a.sent)} mUSD (fill #${a.fillId})`;
    case "PullRequested":
      return `Reactive asked the vault to pull from Morpho${a.attempt > 0 ? ` (retry ${a.attempt})` : ""}`;
    case "FrontRequested":
      return `Reactive asked the reserve to front ${usd(a.amount)} mUSD (fill #${a.fillId})`;
    case "ReimburseRequested":
      return `Reactive asked Unichain to reimburse ${usd(a.amount)} mUSD (fill #${a.fillId})`;
    case "Halted":
      return `Cross-chain fronting halted`;
    case "Reimbursed":
      return `Relayer reimbursed ${usd(a.amount)} mUSD on Unichain (fill #${a.fillId})`;
    case "CreditCommitted":
      return `Credit available: ${usd(a.creditAvailable)} mUSD`;
    default:
      return name;
  }
}

export function useLive(addresses: Record<string, string> | null) {
  const [state, setState] = useState<LiveState | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const cursors = useRef<Partial<Record<ChainKey, bigint>>>({});
  const blockTimes = useRef(new Map<string, number>());
  const senders = useRef(new Map<string, string>());
  const parts = useRef<{ base?: BasePart; uni?: UniPart; lasna?: LasnaPart }>({});
  // Consecutive failures per chain, counted separately for the state reads and the event feed.
  const fails = useRef({ read: { base: 0, uni: 0, lasna: 0 }, feed: { base: 0, uni: 0, lasna: 0 } } as Record<"read" | "feed", Record<ChainKey, number>>);
  const lastReason = useRef<Partial<Record<ChainKey, string>>>({});

  useEffect(() => {
    if (!addresses) return;
    const A = addresses as Record<string, Address>;
    let stopped = false;
    let readBusy = false;
    let feedBusy = false;

    async function readBase(): Promise<BasePart> {
      const b = clients.base;
      const [m, pending, shortfall, len, head, inventory, debtVault, debtReserve] = await Promise.all([
        b.readContract({ address: A.morpho, abi: morphoAbi, functionName: "market", args: [A.marketId as Hex] }),
        b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "pendingTotal" }),
        b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "shortfall" }),
        b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "queueLength" }),
        b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "head" }),
        b.readContract({ address: A.mockUSD, abi: erc20Abi, functionName: "balanceOf", args: [A.relayerReserve] }),
        b.readContract({ address: PROXIES.base, abi: payerAbi, functionName: "debt", args: [A.sluiceVault] }),
        b.readContract({ address: PROXIES.base, abi: payerAbi, functionName: "debt", args: [A.relayerReserve] }),
      ]);
      return { supply: m[0], borrow: m[2], pending, shortfall, queued: len - head, inventory, debtVault, debtReserve };
    }

    async function readUni(): Promise<UniPart> {
      const u = clients.uni;
      const [credit, debtSibling] = await Promise.all([
        u.readContract({ address: A.siblingVault, abi: siblingAbi, functionName: "creditAvailable" }),
        u.readContract({ address: PROXIES.uni, abi: payerAbi, functionName: "debt", args: [A.siblingVault] }),
      ]);
      return { credit, debtSibling };
    }

    async function readLasna(): Promise<LasnaPart> {
      const l = clients.lasna;
      const [halted, delayBlocks, pullPending, fillsOpened, open, debtReactive] = await Promise.all([
        l.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "halted" }),
        l.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "delayBlocks" }),
        l.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "pullPending" }),
        l.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "fillNonce" }),
        l.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "openFills" }),
        l.readContract({ address: PROXIES.system, abi: payerAbi, functionName: "debt", args: [A.sluiceReactive] }),
      ]);
      return { halted, delayBlocks, pullPending, fillsOpened, fillsOpen: open.length, debtReactive };
    }

    async function fetchChain(k: ChainKey): Promise<FeedEvent[]> {
      const c = clients[k];
      const latest = await c.getBlockNumber();
      const from = cursors.current[k] !== undefined ? cursors.current[k]! + 1n : latest - CHAINS[k].window;
      if (from > latest) return [];
      const queries =
        k === "base"
          ? [
              getLogsChunked(c, { address: A.sluiceVault, events: vaultAbi.filter((x) => x.type === "event") }, from, latest),
              getLogsChunked(c, { address: A.morpho, event: morphoAbi[0], args: { id: A.marketId as Hex } }, from, latest),
              getLogsChunked(c, { address: A.relayerReserve, events: reserveAbi }, from, latest),
            ]
          : k === "uni"
            ? [getLogsChunked(c, { address: A.siblingVault, events: siblingAbi.filter((x) => x.type === "event") }, from, latest)]
            : [getLogsChunked(c, { address: A.sluiceReactive, events: reactiveAbi.filter((x) => x.type === "event") }, from, latest)];
      const logs = (await Promise.all(queries)).flat() as any[];
      cursors.current[k] = latest;
      const out: FeedEvent[] = [];
      for (const l of logs) {
        const key = `${k}:${l.blockNumber}`;
        if (!blockTimes.current.has(key)) {
          try {
            const blk = await c.getBlock({ blockNumber: l.blockNumber });
            blockTimes.current.set(key, Number(blk.timestamp));
          } catch {
            /* time stays unknown */
          }
        }
        const sk = `${k}:${l.transactionHash}`;
        if (!senders.current.has(sk)) {
          try {
            const tx = await c.getTransaction({ hash: l.transactionHash });
            senders.current.set(sk, tx.from);
          } catch {
            /* sender stays unknown */
          }
        }
        out.push({
          id: `${k}:${l.transactionHash}:${l.logIndex}`,
          chain: k,
          name: l.eventName,
          text: describe(l.eventName, l.args),
          tx: l.transactionHash,
          block: l.blockNumber,
          time: blockTimes.current.get(key) ?? null,
          from: senders.current.get(sk) ?? null,
        });
      }
      return out;
    }

    function record(kind: "read" | "feed", k: ChainKey, r: PromiseSettledResult<unknown>) {
      if (r.status === "fulfilled") {
        fails.current[kind][k] = 0;
      } else {
        fails.current[kind][k]++;
        lastReason.current[k] = reasonText(r.reason);
      }
    }

    function report() {
      const problems = (Object.keys(CHAINS) as ChainKey[])
        .filter((k) => Math.max(fails.current.read[k], fails.current.feed[k]) >= FAILS_BEFORE_ERROR)
        .map((k) => `${CHAINS[k].label} (${lastReason.current[k] ?? "no answer"})`);
      setError(
        problems.length
          ? `Public RPC not answering: ${problems.join(", ")}. Showing the last values read; retrying every ${POLL_MS / 1000} s.`
          : null,
      );
    }

    // The state reads and the event feed poll separately, so the cards never wait for the feed's history on first
    // load, and a slow RPC never piles up overlapping polls of either kind.
    async function pollState() {
      if (readBusy) return;
      readBusy = true;
      try {
        const [rb, ru, rl] = await Promise.allSettled([readBase(), readUni(), readLasna()]);
        if (stopped) return;
        record("read", "base", rb);
        record("read", "uni", ru);
        record("read", "lasna", rl);
        if (rb.status === "fulfilled") parts.current.base = rb.value;
        if (ru.status === "fulfilled") parts.current.uni = ru.value;
        if (rl.status === "fulfilled") parts.current.lasna = rl.value;

        const { base, uni, lasna } = parts.current;
        if (base && uni && lasna) {
          setState({
            supply: base.supply,
            borrow: base.borrow,
            pending: base.pending,
            shortfall: base.shortfall,
            queued: base.queued,
            inventory: base.inventory,
            credit: uni.credit,
            halted: lasna.halted,
            delayBlocks: lasna.delayBlocks,
            pullPending: lasna.pullPending,
            fillsOpened: lasna.fillsOpened,
            fillsOpen: lasna.fillsOpen,
            debts: { vault: base.debtVault, reserve: base.debtReserve, sibling: uni.debtSibling, reactive: lasna.debtReactive },
          });
        }
        if (rb.status === "fulfilled" && ru.status === "fulfilled" && rl.status === "fulfilled") setUpdatedAt(Date.now());
        report();
      } finally {
        readBusy = false;
      }
    }

    async function pollFeed() {
      if (feedBusy) return;
      feedBusy = true;
      try {
        const [fb, fu, fl] = await Promise.allSettled([fetchChain("base"), fetchChain("uni"), fetchChain("lasna")]);
        if (stopped) return;
        record("feed", "base", fb);
        record("feed", "uni", fu);
        record("feed", "lasna", fl);
        const fresh = [fb, fu, fl].flatMap((f) => (f.status === "fulfilled" ? f.value : []));
        if (fresh.length) {
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const merged = [...prev, ...fresh.filter((e) => !seen.has(e.id))];
            merged.sort((x, y) => (y.time ?? 0) - (x.time ?? 0));
            return merged.slice(0, FEED_MAX);
          });
        }
        report();
      } finally {
        feedBusy = false;
      }
    }

    function tick() {
      void pollState();
      void pollFeed();
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [addresses]);

  return { state, events, error, updatedAt };
}
