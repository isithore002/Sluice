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
const FEED_MAX = 40;
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

  useEffect(() => {
    if (!addresses) return;
    const A = addresses as Record<string, Address>;
    let stopped = false;

    async function readState(): Promise<LiveState> {
      const b = clients.base;
      const [m, pending, shortfall, len, head, inventory, credit, halted, delayBlocks, pullPending, fillsOpened, open] =
        await Promise.all([
          b.readContract({ address: A.morpho, abi: morphoAbi, functionName: "market", args: [A.marketId as Hex] }),
          b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "pendingTotal" }),
          b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "shortfall" }),
          b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "queueLength" }),
          b.readContract({ address: A.sluiceVault, abi: vaultAbi, functionName: "head" }),
          b.readContract({ address: A.mockUSD, abi: erc20Abi, functionName: "balanceOf", args: [A.relayerReserve] }),
          clients.uni.readContract({ address: A.siblingVault, abi: siblingAbi, functionName: "creditAvailable" }),
          clients.lasna.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "halted" }),
          clients.lasna.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "delayBlocks" }),
          clients.lasna.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "pullPending" }),
          clients.lasna.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "fillNonce" }),
          clients.lasna.readContract({ address: A.sluiceReactive, abi: reactiveAbi, functionName: "openFills" }),
        ]);
      const [dv, dr, ds, drc] = await Promise.all([
        b.readContract({ address: PROXIES.base, abi: payerAbi, functionName: "debt", args: [A.sluiceVault] }),
        b.readContract({ address: PROXIES.base, abi: payerAbi, functionName: "debt", args: [A.relayerReserve] }),
        clients.uni.readContract({ address: PROXIES.uni, abi: payerAbi, functionName: "debt", args: [A.siblingVault] }),
        clients.lasna.readContract({ address: PROXIES.system, abi: payerAbi, functionName: "debt", args: [A.sluiceReactive] }),
      ]);
      return {
        supply: m[0],
        borrow: m[2],
        pending,
        shortfall,
        queued: len - head,
        inventory,
        credit,
        halted,
        delayBlocks,
        pullPending,
        fillsOpened,
        fillsOpen: open.length,
        debts: { vault: dv, reserve: dr, sibling: ds, reactive: drc },
      };
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

    async function tick() {
      try {
        const [s, ...feeds] = await Promise.all([readState(), fetchChain("base"), fetchChain("uni"), fetchChain("lasna")]);
        if (stopped) return;
        setState(s);
        const fresh = feeds.flat();
        if (fresh.length) {
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const merged = [...prev, ...fresh.filter((e) => !seen.has(e.id))];
            merged.sort((x, y) => (y.time ?? 0) - (x.time ?? 0));
            return merged.slice(0, FEED_MAX);
          });
        }
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
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
