"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Hex } from "viem";
import { txUrl } from "../../lib/config";
import type { FeedEvent, LiveState } from "../../lib/useLive";
import { isReactiveSigner, short, usd } from "../dashboard/format";
import { groupRows, useSenders, useTreasury, type Counters, type Kind, type Placed, type Row } from "./useTreasury";
import "./demo-treasury.css";

export interface TreasuryViewProps {
  addresses: Record<string, string>;
  state: LiveState | null;
  events: FeedEvent[];
}

const WINDOWS = [5, 10, 20];
/** Chart colours, checked with the dataviz palette validator (dark surface): lightness band, contrast and colour-blind separation all pass. */
const C_FREE = "#4a86f0";
const C_WAIT = "#bd8316";
const C_PAID = "#4ade80";
const C_CASHOUT = "#8f98ad";

// ---- words -------------------------------------------------------------------------------------------------------------
const mUSD = (v: bigint) => `${usd(v < 0n ? -v : v)} mUSD`;
const signed = (v: bigint) => (v === 0n ? "0" : `${v > 0n ? "+" : "−"}${usd(v < 0n ? -v : v)}`);
const clock = (t: number | null) => (t === null ? "time n/a" : new Date(t * 1000).toLocaleTimeString([], { hour12: false }));
const dur = (ms: number | null) => (ms === null ? "n/a" : ms < 1000 ? "under 1 s" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

function eventText(e: Placed): string {
  switch (e.kind) {
    case "repay": return `Borrower repaid ${mUSD(e.amount)} on Morpho`;
    case "borrow": return `Borrower borrowed ${mUSD(e.amount)} from the pool`;
    case "supply": return `${mUSD(e.amount)} supplied to the Morpho market`;
    case "withdraw": return `${mUSD(e.amount)} pulled out of the Morpho market`;
    case "deposit": return `Lender deposited ${mUSD(e.amount)} into the vault`;
    case "queued": return `Lender asked to withdraw ${mUSD(e.amount)}: no cash, so it joined the queue as ticket #${e.requestId}`;
    case "instant": return `Lender withdrew ${mUSD(e.amount)}, paid instantly (the pool had cash)`;
    case "settled": return `Ticket #${e.requestId} paid ${mUSD(e.amount)}${e.remaining && e.remaining > 0n ? ` (${mUSD(e.remaining)} still owed)` : ""}`;
    case "fronted": return `Cross-chain reserve fronted ${mUSD(e.amount)}`;
  }
}

function rowText(r: Row): string {
  const p = r.primary;
  if (p.kind === "settled") {
    const viaDeposit = r.events.some((e) => e.kind === "deposit");
    const viaReserve = r.events.some((e) => e.kind === "fronted");
    // One callback can pay several tickets in a single transaction: name them all, with the total, so the row matches its cash change.
    const paid = r.events.filter((e) => e.kind === "settled");
    const head =
      paid.length > 1
        ? `Tickets ${paid.map((e) => `#${e.requestId}`).join(", ")} paid ${mUSD(paid.reduce((sum, e) => sum + e.amount, 0n))}`
        : eventText(p);
    return `${head}${viaDeposit ? ", out of a new deposit" : viaReserve ? ", out of the cross-chain reserve" : p.traceId ? ", after cash came back" : ""}`;
  }
  if (p.kind === "deposit") return `${eventText(p)} → supplied to Morpho`;
  if (p.kind === "repay") return `${eventText(p)} → cash ${signed(r.cashDelta)}`;
  if (p.kind === "borrow") return `${eventText(p)} → cash ${signed(r.cashDelta)}`;
  return eventText(p);
}

// ---- the chart ------------------------------------------------------------------------------------------------------------
type Lane = 0 | 1 | 2 | 3;
const LANES = ["Requests", "Payouts", "Cash in", "Cash out"];

interface Mark {
  key: string;
  lane: Lane;
  ts: number;
  shape: "bar" | "hollow" | "circle" | "diamond" | "square" | "down";
  color: string;
  size: number;
  items: Placed[];
}

function laneOf(e: Placed): { lane: Lane; shape: Mark["shape"]; color: string } | null {
  switch (e.kind) {
    case "queued": return { lane: 0, shape: "bar", color: C_WAIT };
    case "instant": return { lane: 0, shape: "hollow", color: C_WAIT };
    case "settled": return { lane: 1, shape: "bar", color: C_PAID };
    case "repay": return { lane: 2, shape: "circle", color: C_FREE };
    case "deposit": return { lane: 2, shape: "diamond", color: C_FREE };
    case "fronted": return { lane: 2, shape: "square", color: C_FREE };
    case "borrow": return { lane: 3, shape: "down", color: C_CASHOUT };
    default: return null; // a vault supply/withdraw is part of a deposit or a payout, already marked
  }
}

function niceMax(v: bigint): bigint {
  const steps = [1, 2, 5];
  for (let mag = 1_000_000n; ; mag *= 10n) for (const s of steps) if (BigInt(s) * mag >= v) return BigInt(s) * mag;
}

function useWidth(ref: RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Glyph({ m, x, y }: { m: Mark; x: number; y: number }) {
  const s = m.color;
  switch (m.shape) {
    case "bar": return <rect x={x - 2} y={y - m.size} width={4} height={m.size} rx={1} fill={s} />;
    case "hollow": return <rect x={x - 2} y={y - m.size} width={4} height={m.size} rx={1} fill="none" stroke={s} strokeWidth={1.5} />;
    case "circle": return <circle cx={x} cy={y - 7} r={4.5} fill={s} />;
    case "diamond": return <path d={`M${x} ${y - 12}l4.5 5-4.5 5-4.5-5z`} fill={s} />;
    case "square": return <rect x={x - 4} y={y - 11} width={8} height={8} rx={1.5} fill={s} />;
    case "down": return <path d={`M${x - 4.5} ${y - 12}h9l-4.5 9z`} fill={s} />;
  }
}

function Chart({
  events, startFree, startPending, nowFree, nowPending, t0, t1, rows,
}: {
  events: Placed[]; startFree: bigint; startPending: bigint; nowFree: bigint; nowPending: bigint; t0: number; t1: number; rows: Row[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const [hot, setHot] = useState<Mark | null>(null);
  const [table, setTable] = useState(false);

  const H_PLOT = 170;
  const LANE_H = 24;
  const m = { l: 46, r: W < 520 ? 12 : 92, t: 22, b: 26 };
  const plotW = Math.max(100, W - m.l - m.r);
  const H = m.t + H_PLOT + 10 + LANES.length * LANE_H + m.b;
  const span = Math.max(1, t1 - t0);
  const X = (t: number) => m.l + Math.min(1, Math.max(0, (t - t0) / span)) * plotW;

  let top = nowFree > nowPending ? nowFree : nowPending;
  for (const e of events) {
    if (e.freeAfter > top) top = e.freeAfter;
    if (e.pendingAfter > top) top = e.pendingAfter;
  }
  if (startFree > top) top = startFree;
  if (startPending > top) top = startPending;
  const yMax = niceMax(top);
  const Y = (v: bigint) => m.t + H_PLOT - (Number(v) / Number(yMax)) * H_PLOT;

  const path = (start: bigint, end: bigint, pick: (e: Placed) => bigint) => {
    let d = `M${X(t0)} ${Y(start)}`;
    let prev = start;
    for (const e of events) {
      if (e.ts === null) continue;
      const v = pick(e);
      if (v === prev) continue;
      d += `H${X(e.ts)}V${Y(v)}`;
      prev = v;
    }
    return `${d}H${X(t1)}`;
  };

  // Marks: events in the same lane, of the same kind, in the same second share one mark.
  const marks = useMemo(() => {
    const byKey = new Map<string, Mark>();
    for (const e of events) {
      const l = laneOf(e);
      if (!l || e.ts === null) continue;
      // A withdrawal paid straight from the pool is a request AND cash leaving the pool, so it is marked in both lanes.
      const targets = e.kind === "instant" ? [l, { lane: 3 as Lane, shape: "down" as const, color: C_CASHOUT }] : [l];
      for (const t of targets) {
        const k = `${t.lane}:${e.kind}:${e.ts}`;
        const got = byKey.get(k);
        if (got) got.items.push(e);
        else byKey.set(k, { key: k, lane: t.lane, ts: e.ts, shape: t.shape, color: t.color, size: 0, items: [e] });
      }
    }
    const all = [...byKey.values()];
    const biggest = all.reduce((a, mk) => {
      const tot = mk.items.reduce((s, e) => s + e.amount, 0n);
      return tot > a ? tot : a;
    }, 1n);
    for (const mk of all) {
      const tot = mk.items.reduce((s, e) => s + e.amount, 0n);
      mk.size = 9 + Math.round((9 * Number(tot)) / Number(biggest)); // never smaller than 9 px, so small amounts stay visible
    }
    return all;
  }, [events]);

  const ticks = [0n, yMax / 2n, yMax];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, label: f === 1 ? "now" : `−${(((1 - f) * span) / 60).toFixed(span >= 600 ? 0 : 1)} min` }));
  const empty = events.length === 0;
  const lanesTop = m.t + H_PLOT + 10;
  const label = `Chart of the last ${Math.round(span / 60)} minutes: the Morpho market's free cash now ${usd(nowFree)} mUSD, requests waiting ${usd(nowPending)} mUSD, ${events.length} on-chain events.`;

  return (
    <div className="dm-t-chartbox" ref={wrap} onMouseLeave={() => setHot(null)} onKeyDown={(e) => e.key === "Escape" && setHot(null)}>
      <div className="dm-t-legend" aria-hidden="true">
        <span><i style={{ background: C_FREE }} />Free cash in the pool</span>
        <span><i style={{ background: C_WAIT }} />Waiting for payment</span>
        <span><i className="sq" style={{ background: C_PAID }} />Payout</span>
      </div>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={label}
        className="dm-t-svg"
        data-start-free={startFree.toString()}
        data-now-free={nowFree.toString()}
        data-start-pending={startPending.toString()}
        data-now-pending={nowPending.toString()}
        data-events={events.length}
      >
        {ticks.map((v) => (
          <g key={v.toString()}>
            <line x1={m.l} x2={m.l + plotW} y1={Y(v)} y2={Y(v)} className="dm-t-grid" />
            <text x={m.l - 8} y={Y(v) + 4} textAnchor="end" className="dm-t-axis">{usd(v)}</text>
          </g>
        ))}
        <text x={m.l - 8} y={10} textAnchor="end" className="dm-t-axis">mUSD</text>
        {xTicks.map((t) => (
          <text key={t.f} x={m.l + t.f * plotW} y={H - 8} textAnchor={t.f === 0 ? "start" : t.f === 1 ? "end" : "middle"} className="dm-t-axis">{t.label}</text>
        ))}

        <path d={path(startPending, nowPending, (e) => e.pendingAfter)} fill="none" stroke={C_WAIT} strokeWidth={2} strokeLinejoin="round" />
        <path d={path(startFree, nowFree, (e) => e.freeAfter)} fill="none" stroke={C_FREE} strokeWidth={2} strokeLinejoin="round" />
        {W >= 520 && (
          <>
            <text x={m.l + plotW + 8} y={Y(nowFree) + (nowFree === nowPending ? 12 : 4)} fill={C_FREE} className="dm-t-direct">Cash {usd(nowFree)}</text>
            <text x={m.l + plotW + 8} y={Y(nowPending) + (nowFree === nowPending ? -4 : 4)} fill={C_WAIT} className="dm-t-direct">Waiting {usd(nowPending)}</text>
          </>
        )}

        {LANES.map((name, i) => (
          <g key={name}>
            <line x1={m.l} x2={m.l + plotW} y1={lanesTop + (i + 1) * LANE_H - 2} y2={lanesTop + (i + 1) * LANE_H - 2} className="dm-t-grid" />
            <text x={m.l - 8} y={lanesTop + (i + 1) * LANE_H - 8} textAnchor="end" className="dm-t-lane">{name}</text>
          </g>
        ))}
        {marks.map((mk) => {
          const x = X(mk.ts);
          const y = lanesTop + (mk.lane + 1) * LANE_H - 4;
          const tot = mk.items.reduce((s, e) => s + e.amount, 0n);
          const aria = `${mk.items.length > 1 ? `${mk.items.length} events` : eventText(mk.items[0])} at ${clock(mk.ts)}, ${usd(tot)} mUSD`;
          return (
            <g key={mk.key} tabIndex={0} role="button" aria-label={aria} className="dm-t-mark" onMouseEnter={() => setHot(mk)} onFocus={() => setHot(mk)} onClick={() => setHot(mk)}>
              <rect x={x - 8} y={lanesTop + mk.lane * LANE_H} width={16} height={LANE_H} fill="transparent" />
              <Glyph m={mk} x={x} y={y} />
            </g>
          );
        })}
      </svg>

      {hot && (
        <div className="dm-t-tip" style={{ left: Math.min(Math.max(8, X(hot.ts) - 110), Math.max(8, W - 232)), top: lanesTop + (hot.lane + 1) * LANE_H + 6 }} role="status">
          <p className="dm-t-tip-time">{clock(hot.ts)} · {LANES[hot.lane]}</p>
          {hot.items.slice(0, 4).map((e) => (
            <p key={e.id}>
              {eventText(e)}{" "}
              <a className="sl-link sl-mono" href={txUrl("base", e.tx)} target="_blank" rel="noreferrer">{short(e.tx, 6, 4)} ↗</a>
            </p>
          ))}
          {hot.items.length > 4 && <p className="dm-t-muted">+{hot.items.length - 4} more in the same second</p>}
        </div>
      )}

      <p className="dm-t-shapes" aria-hidden="true">
        <span><b style={{ color: C_WAIT }}>▮</b> request queued</span>
        <span><b style={{ color: C_WAIT }}>▯</b> paid instantly</span>
        <span><b style={{ color: C_PAID }}>▮</b> ticket paid</span>
        <span><b style={{ color: C_FREE }}>◆</b> lender deposit</span>
        <span><b style={{ color: C_FREE }}>●</b> borrower repayment</span>
        <span><b style={{ color: C_FREE }}>■</b> cross-chain front</span>
        <span><b style={{ color: C_CASHOUT }}>▼</b> cash out (borrow or instant withdrawal)</span>
      </p>
      {empty && <p className="dm-t-empty">No requests or cash movements on this market in the last {Math.round(span / 60)} minutes. The lines are flat at today&apos;s values.</p>}
      <p className="dm-t-fine">
        Read from Base Sepolia: the market&apos;s Supply, Withdraw, Borrow and Repay events plus the vault&apos;s request events, replayed backwards from the live state
        so the lines end exactly at today&apos;s numbers. Times are block timestamps (1 s resolution).
      </p>
      <button className="dm-t-link" aria-expanded={table} onClick={() => setTable((t) => !t)}>
        {table ? "Hide the table" : "View the same data as a table"}
      </button>
      {table && <EventTable rows={rows} />}
    </div>
  );
}

function EventTable({ rows }: { rows: Row[] }) {
  const senders = useSenders(rows.filter((r) => r.primary.kind === "settled").map((r) => r.tx));
  return (
    <div className="dm-t-tablewrap">
      <table className="sl-table dm-t-table">
        <caption className="sr-only">Every cash movement and request on the market in this window, oldest first</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">What happened</th>
            <th scope="col">Free cash after</th>
            <th scope="col">Waiting after</th>
            <th scope="col">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5}>Nothing happened in this window.</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.tx + r.block}>
                <td className="sl-mono">{clock(r.ts)}</td>
                <td>
                  {rowText(r)}
                  {isReactiveSigner(senders.get(r.tx) ?? null) && <span className="dm-t-tag"> · sent by Reactive&apos;s signer</span>}
                </td>
                <td className="sl-mono">{usd(r.freeAfter)}</td>
                <td className="sl-mono">{usd(r.pendingAfter)}</td>
                <td><a className="sl-link sl-mono" href={txUrl("base", r.tx)} target="_blank" rel="noreferrer">{short(r.tx, 6, 4)} ↗</a></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- the page of the view -------------------------------------------------------------------------------------------------
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dm-t-stat">
      <span className="dm-t-stat-l">{label}</span>
      <span className="dm-t-stat-v">{value}</span>
      {sub && <span className="dm-t-stat-s">{sub}</span>}
    </div>
  );
}

function Counts({ c, minutes }: { c: Counters; minutes: number }) {
  return (
    <div className="dm-t-counts" role="group" aria-label={`Totals for the last ${minutes} minutes`}>
      <Stat label="Requests received" value={String(c.receivedCount)} sub={`${mUSD(c.receivedAmount)}: ${c.queuedCount} queued, ${c.instantCount} paid instantly`} />
      <Stat label="Payouts from the queue" value={String(c.payoutCount)} sub={`${mUSD(c.paidAmount)} paid, ${c.ticketsPaidInFull} ticket${c.ticketsPaidInFull === 1 ? "" : "s"} in full${c.byReactiveCount ? `, ${c.byReactiveCount} after cash came back` : ""}`} />
      <Stat label="Cash in" value={mUSD(c.depositsAmount + c.repaidAmount + c.frontedAmount)} sub={`${mUSD(c.depositsAmount)} lender deposits, ${mUSD(c.repaidAmount)} borrower repayments${c.frontedAmount ? `, ${mUSD(c.frontedAmount)} cross-chain` : ""}`} />
      <Stat label="Cash out" value={mUSD(c.borrowedAmount + c.paidOutAmount)} sub={`${mUSD(c.borrowedAmount)} borrowed, ${mUSD(c.paidOutAmount)} paid to lenders`} />
      <Stat
        label="Repayment to payout"
        value={c.medianSettleMs === null ? "n/a" : dur(c.medianSettleMs)}
        sub={c.settleSamples ? `median of ${c.settleSamples}; last ${dur(c.lastSettleMs)}. From the borrower's repayment to the payout sent by Reactive's signer; time a ticket spent waiting for cash is not counted.` : "No payout by Reactive within this window."}
      />
    </div>
  );
}

/**
 * The treasury: how much cash the vault can reach right now, how cash came in over the last minutes, how many requests
 * arrived, and how they were paid when cash came back. Every number is a chain read or a decoded event with its
 * transaction link; nothing is estimated or animated without a chain change behind it.
 */
export function TreasuryView({ addresses, state, events: _feed }: TreasuryViewProps) {
  const [minutes, setMinutes] = useState(10);
  const t = useTreasury(addresses, minutes);
  const reach = t.reach;
  const rowsNewest = useMemo(() => [...groupRows(t.events)].reverse(), [t.events]);
  const ledger = rowsNewest.slice(0, 10);
  const senders = useSenders(ledger.filter((r) => r.primary.kind === "settled").map((r) => r.tx as Hex));

  const waiting = reach?.waiting ?? Number(state?.queued ?? 0n);
  const pending = reach?.pending ?? state?.pending ?? 0n;
  const reachable = reach?.reachable ?? 0n;
  const coverage = pending === 0n ? 100 : Math.min(100, Number((reachable * 100n) / pending));

  let sentence = "Reading the vault…";
  if (reach) {
    if (waiting === 0 && reachable === 0n) sentence = "The pool is fully borrowed, so there is no cash to reach, and nobody is waiting.";
    else if (waiting === 0) sentence = `Nobody is waiting. ${usd(reachable)} mUSD of reachable cash is available for the next withdrawal.`;
    else if (reachable >= pending && state && state.debts.reactive > 0n)
      sentence = `Cash ${usd(reachable)} covers the ${usd(pending)} waiting, but Reactive is out of funds (in debt) and cannot pay until it is topped up.`;
    else if (reachable >= pending) sentence = `Cash ${usd(reachable)} covers the ${usd(pending)} waiting: Reactive is paying ${waiting === 1 ? "it" : "them"}.`;
    else if (reachable === 0n) sentence = `Cash 0: ${waiting} request${waiting === 1 ? " is" : "s are"} waiting for cash. When a borrower repays, Reactive pays the next ticket by itself.`;
    else sentence = `Cash ${usd(reachable)} covers part of the ${usd(pending)} waiting. Reactive pays in order as cash arrives.`;
  }

  return (
    <section className="dm-t" aria-labelledby="dm-t-title">
      <div className="dm-t-head">
        <div>
          <p className="sl-kicker">Treasury</p>
          <h3 id="dm-t-title" className="dm-t-h">Cash in, requests in, payouts out</h3>
        </div>
        <div className="sl-seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} className={minutes === w ? "on" : ""} aria-pressed={minutes === w} onClick={() => setMinutes(w)}>
              {w} min
            </button>
          ))}
        </div>
      </div>
      <p className="dm-t-def">
        The treasury is the cash the Sluice vault can reach right now: cash sitting in the vault plus what it can pull out of the Morpho market.
      </p>

      <div className="dm-t-top">
        <div className="sl-card dm-t-now">
          <h3>Treasury now</h3>
          <div className="sl-big" aria-live="polite">{reach ? `${usd(reachable)} mUSD` : "…"}</div>
          <p className="dm-t-sentence" aria-live="polite">{sentence}</p>
          {pending > 0n && (
            <div className="dm-t-cover" role="img" aria-label={`Cash covers ${coverage} percent of what is waiting`}>
              <div style={{ width: `${coverage}%` }} />
            </div>
          )}
          <div className="sl-kv"><span>Cash covers what is waiting</span><span>{pending === 0n ? "nothing waiting" : `${coverage}%`}</span></div>
          <div className="sl-kv"><span>In the vault (idle)</span><span>{reach ? usd(reach.idle) : "…"}</span></div>
          <div className="sl-kv"><span>It can pull from Morpho</span><span>{reach ? usd(reach.morpho) : "…"}</span></div>
          <div className="sl-kv"><span>Waiting for payment</span><span>{reach ? `${usd(pending)} (${waiting} request${waiting === 1 ? "" : "s"})` : "…"}</span></div>
        </div>

        <div className="sl-card dm-t-backup">
          <h3>Cross-chain backup</h3>
          <div className="sl-kv"><span>Reserve inventory (Base)</span><span>{state ? usd(state.inventory) : "…"}</span></div>
          <div className="sl-kv"><span>Credit (Unichain)</span><span>{state ? usd(state.credit) : "…"}</span></div>
          <div className="sl-kv"><span>Fronting</span><span>{state ? (state.halted ? "paused for this demo" : "on") : "…"}</span></div>
          <p className="sl-note">
            {state?.halted
              ? "Not counted in the treasury above. With fronting on, Sluice could pay waiting requests from this backup before cash comes back."
              : "Not counted in the treasury above. When Morpho has no cash, Sluice can pay waiting requests from this backup."}
          </p>
        </div>
      </div>

      <div className="sl-card dm-t-chart">
        <h3>The last {minutes} minutes</h3>
        {t.status === "loading" ? (
          <p className="sl-note" role="status">Reading the last {minutes} minutes from Base Sepolia… {t.progress.total ? `(${t.progress.done} of ${t.progress.total} chunks)` : ""}</p>
        ) : (
          <Chart
            events={t.events}
            rows={t.rows}
            startFree={t.startFree}
            startPending={t.startPending}
            nowFree={reach?.free ?? 0n}
            nowPending={pending}
            t0={t.windowStartTs ?? 0}
            t1={t.nowTs ?? 1}
          />
        )}
        {t.status === "ready" && t.progress.total > 0 && t.progress.done < t.progress.total && (
          <p className="sl-note" role="status">Loading earlier blocks… ({t.progress.done} of {t.progress.total})</p>
        )}
        {t.inconsistent && <p className="sl-err" role="alert">Some events in this window could not be read, so the earliest part of the lines may be off. Reload to retry.</p>}
        {t.error && <p className="sl-err" role="alert">{t.error}</p>}
      </div>

      {t.status === "ready" && <Counts c={t.counters} minutes={minutes} />}

      <div className="sl-card dm-t-ledger">
        <h3>How cash became payouts</h3>
        {ledger.length === 0 ? (
          <p className="sl-note">{t.status === "loading" ? "Reading…" : `Nothing happened on this market in the last ${minutes} minutes.`}</p>
        ) : (
          <ol className="dm-t-list" aria-label="Latest events, newest first">
            {ledger.map((r) => {
              const reactive = r.primary.kind === "settled" && isReactiveSigner(senders.get(r.tx) ?? null);
              return (
                <li key={r.tx + r.block} className={`dm-t-li ${r.primary.kind}`}>
                  <span className="dm-t-time sl-mono">{clock(r.ts)}</span>
                  <span className="dm-t-what">
                    {rowText(r)}
                    {reactive && <span className="dm-t-tag"> · sent by Reactive&apos;s signer</span>}
                    <span className="dm-t-after">
                      Free cash after {usd(r.freeAfter)} · {r.waitingAfter} waiting ({usd(r.pendingAfter)})
                    </span>
                  </span>
                  <span className={`dm-t-delta sl-mono ${r.cashDelta > 0n ? "up" : r.cashDelta < 0n ? "down" : ""}`} title="Change to the market's free cash">
                    {signed(r.cashDelta)}
                  </span>
                  <a className="sl-link sl-mono" href={txUrl("base", r.tx)} target="_blank" rel="noreferrer" aria-label={`Transaction ${short(r.tx, 6, 4)} on the block explorer`}>
                    {short(r.tx, 6, 4)} ↗
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

export type { Kind };
