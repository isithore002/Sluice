"use client";

import { useEffect, useRef, useState } from "react";
import type { BatchResult } from "../../lib/manifest";
import { secs, short, usdStr } from "./format";

/**
 * One repayment, more queued withdrawals than a single callback may pay. Everything shown is read back from the
 * live run: which callback paid which requests, in which order, and how much gas each used against its limit.
 * The grid can be replayed at real speed: each cell lights when the callback that paid it landed.
 */
export function BatchDemo({ batch }: { batch: BatchResult }) {
  const [t, setT] = useState<number | null>(null); // ms since the repayment; null = finished
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const ids = Array.from({ length: batch.n }, (_, i) => batch.firstRequestId + i);
  const cbOf = (id: number) => batch.callbacks.find((c) => id >= c.firstRequestId && id <= c.lastRequestId);

  // When each callback landed, relative to the repayment: the first and last are measured; any in between are spread evenly.
  const first = batch.timing.repayToFirstBatchMs ?? batch.timing.repayToQueueEmptyMs;
  const last = batch.timing.repayToQueueEmptyMs;
  const landed = (k: number) => (batch.callbacks.length <= 1 ? last : first + ((last - first) * (k - 1)) / (batch.callbacks.length - 1));
  const lightAt = (id: number) => {
    const c = cbOf(id);
    return c ? landed(c.batch) : Infinity; // every request in a callback is paid by ONE transaction, so they light up together
  };
  const end = Math.max(...ids.map(lightAt)) + 500;
  const lit = (id: number) => t === null || t >= lightAt(id);
  const paid = t === null ? batch.n : ids.filter((id) => t >= lightAt(id)).length;

  const play = () => {
    cancelAnimationFrame(raf.current);
    setPlaying(true);
    setT(0);
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= end) {
        setT(null);
        setPlaying(false);
        return;
      }
      setT(elapsed);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const gasPct = (g: number, limit: number) => Math.round((g / limit) * 100);

  return (
    <div className="bd">
      <div className="sl-grid bd-facts">
        <div className="sl-card">
          <h3>Queued</h3>
          <div className="sl-big">{batch.n} withdrawals</div>
          <p className="sl-note">{usdStr(batch.each)} mUSD each, from {batch.n} separate wallets, nothing reachable</p>
        </div>
        <div className="sl-card">
          <h3>Repayments</h3>
          <div className="sl-big">1</div>
          <p className="sl-note">{usdStr(batch.total)} mUSD into Morpho, one transaction</p>
        </div>
        <div className="sl-card">
          <h3>Callbacks</h3>
          <div className="sl-big">
            {batch.callbacks.length} <span className="bd-dim">({batch.callbacks.map((c) => c.payments).join(" + ")})</span>
          </div>
          <p className="sl-note">a callback pays at most {batch.cap}; Reactive scheduled the next one itself</p>
        </div>
        <div className="sl-card">
          <h3>Repayment → all paid</h3>
          <div className="sl-big">{secs(batch.timing.repayToQueueEmptyMs)}</div>
          <p className="sl-note">no new deposit, no manual call</p>
        </div>
      </div>

      <div className="sl-card bd-board">
        <div className="bd-boardhead">
          <h3>
            Payout order <span className="bd-dim">· {paid} of {batch.n} paid</span>
          </h3>
          <button className="sl-btn small primary" onClick={play}>
            {playing ? "Restart" : "Replay"} <span aria-hidden="true">▶</span>
          </button>
        </div>
        <ol className="bd-cells" aria-label={`Withdrawal requests ${ids[0]} to ${ids[ids.length - 1]}, coloured by the callback that paid them`}>
          {ids.map((id) => {
            const c = cbOf(id);
            return (
              <li
                key={id}
                className={`bd-cell b${c?.batch ?? 0}${lit(id) ? " on" : ""}`}
                title={`Request #${id}: paid by callback ${c?.batch ?? "?"}`}
              >
                {id - batch.firstRequestId + 1}
              </li>
            );
          })}
        </ol>
        <div className="bd-legend">
          {batch.callbacks.map((c) => (
            <span key={c.batch}>
              <i className={`bd-key b${c.batch}`} aria-hidden="true" />
              Callback {c.batch}: requests {c.firstRequestId - batch.firstRequestId + 1}–{c.lastRequestId - batch.firstRequestId + 1}
            </span>
          ))}
        </div>
        <p className="sl-note">
          {batch.fifo.ok ? (
            <>
              <b className="bd-ok">✓ First come, first served.</b> Request ids {ids[0]} to {ids[ids.length - 1]} were paid strictly in order, with no gaps, and
              every wallet holds its {usdStr(batch.each)} mUSD
              {batch.allLendersPaidInFull ? "." : " (check failed!)."}
            </>
          ) : (
            "Order check failed."
          )}
        </p>
        <p className="sl-note">
          The replay shows when each callback landed (measured). The requests inside one callback are all paid by a single transaction, so they light up together.
          The {batch.n} lenders are wallets we control.
        </p>
      </div>

      <div className="sl-card sl-scroll">
        <table className="sl-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>What happened</th>
              <th className="num">Gas used / limit</th>
              <th>Transactions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>One repayment frees cash for all {batch.n} queued withdrawals.</td>
              <td className="num">n/a</td>
              <td className="bd-links">
                <a className="sl-link" href={batch.links.repay} target="_blank" rel="noreferrer">
                  Repay (Base) ↗
                </a>
              </td>
            </tr>
            {batch.callbacks.map((c, i) => (
              <tr key={c.tx}>
                <td>{i + 2}</td>
                <td>
                  Omni {i === 0 ? "reacts and asks the vault to pull and pay" : "sees cash is still reachable and asks for the next batch"}. Callback {c.batch} pays{" "}
                  <b>{c.payments}</b> requests (#{c.firstRequestId - batch.firstRequestId + 1}–{c.lastRequestId - batch.firstRequestId + 1}).
                  {i === 0 && batch.timing.repayToFirstBatchMs !== null && <> Landed {secs(batch.timing.repayToFirstBatchMs)} after the repayment.</>}
                  {i === batch.callbacks.length - 1 && <> Queue empty {secs(batch.timing.repayToQueueEmptyMs)} after the repayment.</>}
                </td>
                <td className="num">
                  {c.gasUsed.toLocaleString("en-US")} / {c.gasLimitRequested.toLocaleString("en-US")}
                  <div className="sl-meter" role="img" aria-label={`${gasPct(c.gasUsed, c.gasLimitRequested)} percent of the gas limit`}>
                    <div style={{ width: `${gasPct(c.gasUsed, c.gasLimitRequested)}%` }} />
                  </div>
                </td>
                <td className="bd-links">
                  {batch.reactive[i] && (
                    <>
                      <a className="sl-link" href={batch.reactive[i].link} target="_blank" rel="noreferrer">
                        Omni request (Lasna) ↗
                      </a>
                      <br />
                    </>
                  )}
                  <a className="sl-link" href={c.link} target="_blank" rel="noreferrer">
                    Callback {c.batch} (Base) ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="bd-queued">
          <summary>The {batch.n} queued requests, with the transaction that queued each</summary>
          <ul>
            {batch.queued.map((q) => (
              <li key={q.requestId}>
                <span>#{q.requestId - batch.firstRequestId + 1}</span>
                <span className="sl-mono">{short(q.owner, 6, 4)}</span>
                <a className="sl-link" href={q.link} target="_blank" rel="noreferrer">
                  queued ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
        <p className="sl-note">
          The same scenario runs as Foundry tests against the real Morpho bytecode: 40 queued → 2 callbacks, 80 queued → 4, and cash for only 30 of 40 stops
          at 30 instead of looping. A full 25-payment callback to fresh recipients uses 927,744 gas, 62% of the 1.5M limit.
        </p>
      </div>
    </div>
  );
}
