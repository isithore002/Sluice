"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { numberToHex, parseEventLogs, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { reactiveAbi } from "../../lib/abis";
import { clients, txUrl } from "../../lib/config";
import { vaultUserAbi } from "../../lib/demo";
import type { FeedEvent, LiveState } from "../../lib/useLive";
import { isReactiveSigner, short, usd } from "../dashboard/format";
import "./demo-pool.css";

interface Props {
  addresses: Record<string, string>;
  state: LiveState | null;
  events: FeedEvent[];
}

interface Ticket {
  id: bigint;
  owner: Address;
  remaining: bigint;
}

interface Settled {
  tx: Hex;
  requestId: bigint;
  owner: Address;
  paid: bigint;
  remaining: bigint;
  traceId: bigint;
}

const QUEUE_SHOWN = 8;
const POLL_MS = 3000;
const PAID_SHOWN_FOR_S = 120;

const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const nowS = () => Date.now() / 1000;

/**
 * The pool, as the chain shows it right now: the Morpho market's free cash, the vault's withdrawal queue as tickets, and
 * the last settlement Reactive made (repay -> Reactive -> payout), matched by trace id. Nothing here is simulated: every
 * number is read from the chains, and the strip stays empty until a real repayment has been settled.
 */
export function PoolView({ addresses, state, events }: Props) {
  const vault = addresses.sluiceVault as Address;
  const { address: me } = useAccount();

  // ---- the queue: head..queueLength tickets, read from the vault -------------------------------------------------
  const [queue, setQueue] = useState<{ head: bigint; len: bigint; tickets: Ticket[] } | null>(null);
  useEffect(() => {
    let stopped = false;
    async function read() {
      try {
        const b = clients.base;
        const [head, len] = await Promise.all([
          b.readContract({ address: vault, abi: vaultUserAbi, functionName: "head" }),
          b.readContract({ address: vault, abi: vaultUserAbi, functionName: "queueLength" }),
        ]);
        const end = len < head + BigInt(QUEUE_SHOWN) ? len : head + BigInt(QUEUE_SHOWN);
        const ids: bigint[] = [];
        for (let i = head; i < end; i++) ids.push(i);
        const rows = await Promise.all(ids.map((id) => b.readContract({ address: vault, abi: vaultUserAbi, functionName: "request", args: [id] })));
        if (stopped) return;
        setQueue({ head, len, tickets: rows.map((r, i) => ({ id: ids[i], owner: r[0], remaining: r[1] })) });
      } catch {
        /* keep the last queue; the next poll retries */
      }
    }
    void read();
    const t = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // A change in the live state (new request, payout) is a reason to look again straight away.
  }, [vault, state?.queued, state?.pending]);

  // ---- settlements and Reactive's reaction, decoded from real receipts ------------------------------------------
  const settledCache = useRef(new Map<string, Settled[]>());
  const pullCache = useRef(new Map<string, bigint[]>());
  const timeCache = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  const settleEvents = useMemo(() => {
    const seen = new Set<string>();
    return events
      .filter((e) => e.chain === "base" && e.name === "WithdrawSettled")
      .filter((e) => (seen.has(e.tx) ? false : (seen.add(e.tx), true)))
      .slice(0, 5);
  }, [events]);
  const pullEvents = useMemo(() => {
    const seen = new Set<string>();
    return events
      .filter((e) => e.chain === "lasna" && e.name === "PullRequested")
      .filter((e) => (seen.has(e.tx) ? false : (seen.add(e.tx), true)))
      .slice(0, 8);
  }, [events]);

  useEffect(() => {
    let stopped = false;
    (async () => {
      let changed = false;
      for (const e of settleEvents) {
        if (settledCache.current.has(e.tx)) continue;
        try {
          const rc = await clients.base.getTransactionReceipt({ hash: e.tx });
          const logs = parseEventLogs({ abi: vaultUserAbi, eventName: "WithdrawSettled", logs: rc.logs.filter((l) => sameAddr(l.address, vault)) });
          settledCache.current.set(
            e.tx,
            logs.map((l) => ({ tx: e.tx, requestId: l.args.requestId, owner: l.args.owner, paid: l.args.paid, remaining: l.args.remaining, traceId: l.args.traceId })),
          );
          changed = true;
        } catch {
          /* retried on the next events update */
        }
      }
      for (const e of pullEvents) {
        if (pullCache.current.has(e.tx)) continue;
        try {
          const rc = await clients.lasna.getTransactionReceipt({ hash: e.tx });
          const logs = parseEventLogs({ abi: reactiveAbi, eventName: "PullRequested", logs: rc.logs });
          pullCache.current.set(e.tx, logs.map((l) => l.args.traceId));
          changed = true;
        } catch {
          /* retried */
        }
      }
      if (changed && !stopped) setVersion((v) => v + 1);
    })();
    return () => {
      stopped = true;
    };
  }, [settleEvents, pullEvents, vault]);

  // The newest settlement that a repayment caused (trace id 0 means a deposit or poke paid it, not Reactive).
  const chain = useMemo(() => {
    void version;
    for (const e of settleEvents) {
      const logs = settledCache.current.get(e.tx);
      const trace = logs?.find((l) => l.traceId !== 0n)?.traceId;
      if (trace === undefined) continue;
      const repayHash = numberToHex(trace, { size: 32 });
      const repay = events.find((x) => x.chain === "base" && x.name === "Repay" && x.tx.toLowerCase() === repayHash);
      const pull = pullEvents.find((p) => pullCache.current.get(p.tx)?.some((t) => t === trace));
      return { settle: e, logs: logs!, repayHash: repayHash as Hex, repay: repay ?? null, pull: pull ?? null };
    }
    return null;
  }, [settleEvents, pullEvents, events, version]);

  // The repay may be older than the feed's window: look its block time up directly.
  useEffect(() => {
    if (!chain || chain.repay || timeCache.current.has(chain.repayHash)) return;
    let stopped = false;
    (async () => {
      try {
        const rc = await clients.base.getTransactionReceipt({ hash: chain.repayHash });
        const blk = await clients.base.getBlock({ blockNumber: rc.blockNumber });
        timeCache.current.set(chain.repayHash, Number(blk.timestamp));
        if (!stopped) setVersion((v) => v + 1);
      } catch {
        /* the strip then shows the repay without a time */
      }
    })();
    return () => {
      stopped = true;
    };
  }, [chain]);

  // Tickets paid in the last two minutes stay on screen, greyed, so the viewer sees them turn paid.
  const paid = useMemo(() => {
    void version;
    const out: (Settled & { time: number | null })[] = [];
    for (const e of settleEvents) {
      if (e.time !== null && nowS() - e.time > PAID_SHOWN_FOR_S) continue;
      for (const s of settledCache.current.get(e.tx) ?? []) out.push({ ...s, time: e.time });
    }
    return out.slice(0, 3);
  }, [settleEvents, version, state]);

  return (
    <div className="dm-p">
      <PoolTank state={state} />
      <QueueCard queue={queue} paid={paid} me={me} pending={state?.pending ?? null} />
      <ReactiveStrip chain={chain} repayTime={chain ? (chain.repay?.time ?? timeCache.current.get(chain.repayHash) ?? null) : null} />
      <RoleLegend />
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------

function PoolTank({ state }: { state: LiveState | null }) {
  if (!state) {
    return (
      <div className="sl-card dm-p-tank">
        <h3>The pool</h3>
        <p className="sl-note">Reading the Morpho market…</p>
      </div>
    );
  }
  const supply = state.supply;
  const free = supply > state.borrow ? supply - state.borrow : 0n;
  const freePct = supply > 0n ? Number((free * 10000n) / supply) / 100 : 0;
  const util = supply > 0n ? Number((state.borrow * 10000n) / supply) / 100 : 0;
  return (
    <div className="sl-card dm-p-tank">
      <h3>The pool</h3>
      <div className="dm-p-tankrow">
        <div className="dm-p-tankbox" role="img" aria-label={`Free cash ${usd(free)} of ${usd(supply)} mUSD supplied, ${util} percent borrowed`}>
          <div className="dm-p-liquid" style={{ height: `${Math.min(100, freePct)}%` }} />
          {free === 0n && <span className="dm-p-empty">no free cash</span>}
        </div>
        <div className="dm-p-nums">
          <div className="sl-kv">
            <span>Supplied by lenders</span>
            <span>{usd(supply)}</span>
          </div>
          <div className="sl-kv">
            <span>Borrowed out</span>
            <span>{usd(state.borrow)}</span>
          </div>
          <div className="sl-kv">
            <span>Free cash</span>
            <span>{usd(free)}</span>
          </div>
          <div className="sl-kv">
            <span>Utilization</span>
            <span>{util}%</span>
          </div>
        </div>
      </div>
      <p className={`dm-p-free${free === 0n ? " none" : ""}`}>
        {free === 0n ? "Free cash 0: lenders who ask now wait in line." : `Free cash ${usd(free)} mUSD: lenders who ask now are paid straight away.`}
      </p>
      <p className="sl-note">Deposits come from lenders (through the Sluice vault); borrowing comes from borrowers (on Morpho). Both move this tank.</p>
    </div>
  );
}

function QueueCard({
  queue,
  paid,
  me,
  pending,
}: {
  queue: { head: bigint; len: bigint; tickets: Ticket[] } | null;
  paid: (Settled & { time: number | null })[];
  me: Address | undefined;
  pending: bigint | null;
}) {
  const waiting = queue ? queue.len - queue.head : null;
  const more = queue && waiting !== null ? Number(waiting) - queue.tickets.length : 0;
  return (
    <div className="sl-card dm-p-queue" aria-live="polite">
      <h3>The queue</h3>
      <p className="dm-p-qhead">
        {waiting === null ? "Reading the queue…" : waiting === 0n ? "Nobody is waiting." : `${waiting.toString()} waiting · ${usd(pending ?? 0n)} mUSD owed, first come first served`}
      </p>
      <ol className="dm-p-tickets">
        {paid.map((p) => (
          <li key={`${p.tx}-${p.requestId}`} className="dm-p-ticket paid">
            <span className="dm-p-id">#{p.requestId.toString()}</span>
            <span className="dm-p-who sl-mono">
              {short(p.owner, 4, 4)}
              {sameAddr(p.owner, me) && <em className="dm-p-you">you</em>}
            </span>
            <span className="dm-p-amt">{usd(p.paid)}</span>
            <span className="dm-p-state">
              ✓ {p.remaining === 0n ? "paid" : `part paid, ${usd(p.remaining)} left`}{" "}
              <a className="sl-link" href={txUrl("base", p.tx)} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            </span>
          </li>
        ))}
        {queue?.tickets.map((t, i) => (
          <li key={t.id.toString()} className={`dm-p-ticket${i === 0 ? " next" : ""}`}>
            <span className="dm-p-id">#{t.id.toString()}</span>
            <span className="dm-p-who sl-mono">
              {short(t.owner, 4, 4)}
              {sameAddr(t.owner, me) && <em className="dm-p-you">you</em>}
            </span>
            <span className="dm-p-amt">{usd(t.remaining)}</span>
            <span className="dm-p-state">{i === 0 ? "next to be paid" : `position ${i + 1}`}</span>
          </li>
        ))}
      </ol>
      {more > 0 && <p className="sl-note">+{more} more behind these.</p>}
    </div>
  );
}

function ReactiveStrip({
  chain,
  repayTime,
}: {
  chain: { settle: FeedEvent; logs: Settled[]; repayHash: Hex; repay: FeedEvent | null; pull: FeedEvent | null } | null;
  repayTime: number | null;
}) {
  if (!chain) {
    return (
      <div className="sl-card dm-p-strip">
        <h3>What Reactive just did</h3>
        <p className="sl-note">Waiting for the next repayment. When a borrower repays, the steps below appear with their real transactions.</p>
      </div>
    );
  }
  const settleT = chain.settle.time;
  const off = (t: number | null | undefined) => (t != null && repayTime != null ? Math.max(0, t - repayTime) : null);
  const total = off(settleT);
  const paidTotal = chain.logs.reduce((n, l) => n + l.paid, 0n);
  const signer = isReactiveSigner(chain.settle.from);
  const steps = [
    { chip: "base", name: "Borrower repays on Morpho", tx: chain.repayHash, chain: "base" as const, at: repayTime != null ? "start" : "" },
    {
      chip: "lasna",
      name: "Reactive sees it on Lasna",
      tx: chain.pull?.tx ?? null,
      chain: "lasna" as const,
      at: chain.pull ? fmtOff(off(chain.pull.time)) : "not in the recent feed",
    },
    {
      chip: "base",
      name: signer ? "Reactive's signer pays the queue" : "The queue is paid",
      tx: chain.settle.tx,
      chain: "base" as const,
      at: fmtOff(total),
    },
  ];
  return (
    <div className="sl-card dm-p-strip">
      <h3>What Reactive just did</h3>
      <p className="dm-p-sum">
        {total !== null ? (
          <>
            <b>Paid {usd(paidTotal)} mUSD about {total} s after the repayment.</b> Nobody called Sluice.
          </>
        ) : (
          <b>Paid {usd(paidTotal)} mUSD after a repayment. Nobody called Sluice.</b>
        )}
      </p>
      <ol className="dm-p-steps">
        {steps.map((s, i) => (
          <li key={i} className="dm-p-step">
            <span className={`dm-p-dot ${s.chip}`} aria-hidden="true" />
            <span className="dm-p-sname">{s.name}</span>
            <span className="dm-p-sat">{s.at}</span>
            {s.tx ? (
              <a className="sl-link sl-mono" href={txUrl(s.chain, s.tx)} target="_blank" rel="noreferrer">
                {short(s.tx, 6, 4)} ↗
              </a>
            ) : (
              <span className="dm-p-sat">–</span>
            )}
          </li>
        ))}
      </ol>
      <p className="sl-note">Times are block timestamps (one-second resolution; the chains' clocks can differ by a second).</p>
    </div>
  );
}

function fmtOff(s: number | null): string {
  return s === null ? "" : s === 0 ? "same second" : `+${s} s`;
}

function RoleLegend() {
  return (
    <div className="sl-card dm-p-legend">
      <h3>Who does what</h3>
      <svg viewBox="0 0 720 250" role="img" aria-label="Lenders deposit into the Sluice vault, which supplies the Morpho market. Borrowers borrow from and repay Morpho. Reactive watches Morpho and calls the vault.">
        <defs>
          <marker id="dm-p-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#7d8393" />
          </marker>
        </defs>
        <g className="dm-p-svg" fontSize="17">
          <rect x="4" y="30" width="140" height="62" rx="12" className="n lender" />
          <text x="74" y="56" textAnchor="middle">Lender</text>
          <text x="74" y="78" textAnchor="middle" className="s">deposit · withdraw</text>

          <rect x="208" y="30" width="148" height="62" rx="12" className="n vault" />
          <text x="282" y="56" textAnchor="middle">Sluice vault</text>
          <text x="282" y="78" textAnchor="middle" className="s">the queue</text>

          <rect x="420" y="30" width="140" height="62" rx="12" className="n morpho" />
          <text x="490" y="56" textAnchor="middle">Morpho market</text>
          <text x="490" y="78" textAnchor="middle" className="s">the cash</text>

          <rect x="600" y="30" width="116" height="62" rx="12" className="n borrower" />
          <text x="658" y="56" textAnchor="middle">Borrower</text>
          <text x="658" y="78" textAnchor="middle" className="s">borrow · repay</text>

          <line x1="146" y1="61" x2="206" y2="61" markerEnd="url(#dm-p-arrow)" className="l" />
          <line x1="358" y1="61" x2="418" y2="61" markerEnd="url(#dm-p-arrow)" className="l" />
          <line x1="598" y1="61" x2="562" y2="61" markerEnd="url(#dm-p-arrow)" className="l" />

          <rect x="208" y="160" width="352" height="64" rx="12" className="n reactive" />
          <text x="384" y="187" textAnchor="middle">Reactive (Lasna)</text>
          <text x="384" y="210" textAnchor="middle" className="s">sees the repayment, tells the vault to pay</text>

          <path d="M470 160 L470 96" markerEnd="url(#dm-p-arrow)" className="l dash" />
          <text x="478" y="132" className="s">watches</text>
          <path d="M296 160 L296 96" markerEnd="url(#dm-p-arrow)" className="l dash" />
          <text x="214" y="132" className="s">calls the vault</text>
        </g>
      </svg>
      <ul className="dm-p-lglist">
        <li><b>Lender</b> deposits into and withdraws from the Sluice vault, which keeps the queue.</li>
        <li><b>Sluice vault</b> supplies the lenders&apos; cash to the Morpho market.</li>
        <li><b>Borrower</b> borrows from and repays the Morpho market directly.</li>
        <li><b>Reactive (Lasna)</b> watches Morpho; on a repayment it tells the vault to pay the queue.</li>
      </ul>
      <p className="sl-note">
        The borrower never uses Sluice, and the lender never uses Morpho directly. The call to the vault is sent by Reactive&apos;s own signer, not by us.
      </p>
    </div>
  );
}
