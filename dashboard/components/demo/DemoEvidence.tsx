"use client";

import type { BatchResult, DemoRun, RaceCell } from "../../lib/manifest";
import { secs, secs1, short, usdStr } from "../dashboard/format";
import "./demo-evidence.css";

/**
 * The two recorded runs a judge needs next to the live demo, read from results/ (not replayed or re-created):
 * one repayment paying 40 queued withdrawals in two callbacks, and the latency race at Omni speed against the same
 * system slowed by six blocks. Every hash links to its explorer page.
 */
export function DemoEvidence({ batch, race, demoRun }: { batch: BatchResult | null; race: RaceCell[]; demoRun: DemoRun | null }) {
  return (
    <div className="dm-ev">
      {demoRun && <RunEvidence run={demoRun} />}
      {batch && <BatchEvidence batch={batch} />}
      {race.length > 0 && <RaceEvidence race={race} />}
    </div>
  );
}

function RunEvidence({ run }: { run: DemoRun }) {
  return (
    <div className="sl-card dm-ev-card">
      <h3>A full lender and borrower run, recorded</h3>
      <p className="dm-ev-lede">
        Two brand-new wallets drove the Live demo above, step by step. The lender&apos;s withdrawal queued because the borrower had taken the cash; the borrower&apos;s
        repayment on Morpho is the last thing either of them did. About {run.repayToPaidSeconds} s later Reactive&apos;s signer paid the lender {usdStr(run.settlePaid)} mUSD.
      </p>
      <ol className="dm-ev-rows">
        {run.steps.map((t) => (
          <li key={t.hash}>
            <span>
              <b>{t.role === "lender" ? "Lender" : "Borrower"}</b> · {t.label}
            </span>
            <a className="sl-link sl-mono" href={`https://sepolia.basescan.org/tx/${t.hash}`} target="_blank" rel="noreferrer">
              {short(t.hash, 8, 6)} ↗
            </a>
          </li>
        ))}
        <li>
          <span>
            <b>Reactive&apos;s signer pays the ticket</b>
            {run.callbackSentByReactiveSigner ? " · ✓ sent by Reactive, not by us" : ""}
          </span>
          <a className="sl-link sl-mono" href={`https://sepolia.basescan.org/tx/${run.settleTx}`} target="_blank" rel="noreferrer">
            {short(run.settleTx, 8, 6)} ↗
          </a>
        </li>
      </ol>
      <p className="dm-ev-foot">
        Lender <span className="sl-mono">{short(run.lender, 4, 4)}</span> and borrower <span className="sl-mono">{short(run.borrower, 4, 4)}</span> are separate wallets we created
        for the test and funded with gas. The paying callback&apos;s trace id is the borrower&apos;s repay transaction. Recorded{" "}
        {new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
      </p>
    </div>
  );
}

function BatchEvidence({ batch }: { batch: BatchResult }) {
  const lastId = batch.firstRequestId + batch.n - 1;
  const cb = batch.callbacks;
  return (
    <div className="sl-card dm-ev-card">
      <h3>{batch.n} withdrawals, one repayment</h3>
      <p className="dm-ev-lede">
        {batch.n} lenders were queued with nothing to pay them. One borrower repayment later, Reactive paid all {batch.n}, {cb.map((c) => c.payments).join(" then ")} per
        callback, in {secs(batch.timing.repayToQueueEmptyMs)}.
      </p>

      <ol className="dm-ev-rows">
        <li>
          <span>Borrower&apos;s repayment (Morpho, Base)</span>
          <a className="sl-link sl-mono" href={batch.links.repay} target="_blank" rel="noreferrer">
            {short(batch.txs.repay, 8, 6)} ↗
          </a>
        </li>
        {cb.map((c, i) => (
          <li key={c.batch}>
            <span>
              Callback {c.batch} pays <b>{c.payments}</b> requests (#{c.firstRequestId} to #{c.lastRequestId}), {secs1(c.chainSecondsAfterRepay * 1000)} after the repay
              {batch.reactive[i] && (
                <>
                  {" "}
                  ·{" "}
                  <a className="sl-link" href={batch.reactive[i].link} target="_blank" rel="noreferrer">
                    Reactive&apos;s reaction on Lasna ↗
                  </a>
                </>
              )}
            </span>
            <a className="sl-link sl-mono" href={c.link} target="_blank" rel="noreferrer">
              {short(c.tx, 8, 6)} ↗
            </a>
          </li>
        ))}
      </ol>

      <div
        className="dm-ev-cells"
        role="img"
        aria-label={`Requests ${batch.firstRequestId} to ${lastId}, paid in order: the first ${cb[0]?.payments} by callback 1, the next ${cb[1]?.payments} by callback 2`}
      >
        {Array.from({ length: batch.n }, (_, i) => {
          const id = batch.firstRequestId + i;
          const c = cb.find((x) => id >= x.firstRequestId && id <= x.lastRequestId);
          return <i key={id} className={`dm-ev-cell b${c?.batch ?? 0}`} title={`Request #${id}: paid by callback ${c?.batch ?? "?"}`} />;
        })}
      </div>
      <p className="dm-ev-foot">
        {batch.fifo.ok ? (
          <>
            <b className="dm-ev-ok">✓ First come, first served:</b> ids #{batch.firstRequestId} to #{lastId} were paid strictly in order with no gaps
            {batch.allLendersPaidInFull ? ", and every lender was paid in full." : "."}
          </>
        ) : (
          "Order check failed."
        )}{" "}
        A callback pays at most {batch.cap}, so Reactive scheduled the second one itself. Recorded {new Date(batch.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
      </p>
    </div>
  );
}

function RaceEvidence({ race }: { race: RaceCell[] }) {
  const delays = [...new Set(race.map((c) => c.competitorDelayS))].sort((a, b) => a - b);
  const get = (blocks: number, d: number) => race.find((c) => c.delayBlocks === blocks && c.competitorDelayS === d);
  const pct = (c?: RaceCell) => (c ? `${Math.round(c.meanCapture * 100)}%` : "–");
  const cls = (c?: RaceCell) => (c && c.meanCapture === 1 ? "win" : c && c.meanCapture === 0 ? "lose" : "");
  const rivalWins = (blocks: number) => {
    const c = get(blocks, 0);
    return c ? { rounds: c.rounds, won: Math.round(c.rounds * (1 - c.meanCapture)) } : null;
  };
  const omni0 = rivalWins(0);
  const slow0 = rivalWins(6);
  return (
    <div className="sl-card dm-ev-card">
      <h3>What changes when Omni reacts faster</h3>
      <p className="dm-ev-lede">
        After each repayment a competitor bot tries to grab the freed cash, waiting 0, 1, 2, 4 or 8 seconds first. Each cell is the share of rounds in which the queue got
        that cash instead ({race[0]?.rounds ?? 6} rounds per cell).
      </p>

      <div className="dm-ev-tablewrap">
        <table className="sl-table dm-ev-table">
          <caption className="sr-only">
            Share of rounds in which the queue captured the freed cash, by how long the competitor waited, at Omni speed and at six blocks of delay
          </caption>
          <thead>
            <tr>
              <th scope="col">Competitor waits</th>
              <th scope="col">Omni speed</th>
              <th scope="col">Six-block delay (legacy-speed approximation)</th>
            </tr>
          </thead>
          <tbody>
            {delays.map((d) => {
              const a = get(0, d);
              const b = get(6, d);
              return (
                <tr key={d}>
                  <th scope="row">{d === 0 ? "no wait" : `${d} s`}</th>
                  <td className={cls(a)}>
                    <b>{pct(a)}</b>
                    <span>Sluice acts in {a ? secs1(a.sluiceActedMs.median) : "–"}</span>
                  </td>
                  <td className={cls(b)}>
                    <b>{pct(b)}</b>
                    <span>Sluice acts in {b ? secs1(b.sluiceActedMs.median) : "–"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="dm-ev-notes">
        <li>
          <b>The result:</b> against a competitor who waits 1 to 4 seconds, the queue captures <b>100%</b> of the cash at Omni speed and <b>0%</b> at six blocks of delay.
          For users, that is the difference between being paid first and being paid after the bot.
        </li>
        <li>
          <b>The six-block delay is an approximation of legacy speed.</b> It slows the same Reactive contract by six blocks to reproduce the old network&apos;s ~7 s blocks.
          That network no longer exists, so a real run against it is not possible.
        </li>
        <li>
          <b>A competitor with no delay still wins most rounds</b>
          {omni0 && slow0 ? (
            <>
              : it took {omni0.won} of {omni0.rounds} at Omni speed and {slow0.won} of {slow0.rounds} at six blocks. Reacting in about a second does not beat a bot that is
              already watching, and we don&apos;t claim it does.
            </>
          ) : (
            "."
          )}
        </li>
        <li>
          The competitor bot is a wallet of ours.{" "}
          <a className="sl-link" href="#replay">
            Replay each round with its transactions
          </a>
          .
        </li>
      </ul>
    </div>
  );
}
