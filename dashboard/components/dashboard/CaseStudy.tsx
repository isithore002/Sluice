"use client";

import type { CaseStep, CaseStudy } from "../../lib/manifest";
import { addrUrl } from "../../lib/config";
import { chainName, chipClass, secs, short, usdStr } from "./format";

const REPO = "https://github.com/isithore002/Sluice/blob/main";

function Steps({ steps, originTs }: { steps: CaseStep[]; originTs: number | null }) {
  return (
    <ol className="cs-steps">
      {steps.map((s) => (
        <li key={s.key} className={`cs-step ${s.status}`}>
          <span className="cs-icon" aria-hidden="true">
            {s.status === "ok" ? "✓" : "✗"}
          </span>
          <div>
            <div className="cs-title">
              <span className="sr-only">{s.status === "ok" ? "Succeeded: " : "Failed: "}</span>
              {s.label}
              <span className={`sl-chip ${chipClass[s.chain]}`}>{chainName[s.chain]}</span>
              {s.ts !== null && originTs !== null && (
                <span className="cs-time" title="Block timestamps have 1 s resolution, and the chains' clocks differ by about a second">
                  +{Math.max(0, s.ts - originTs)} s
                </span>
              )}
            </div>
            {s.note && <p className="cs-note">{s.note}</p>}
            <a className="sl-link sl-mono" href={s.link} target="_blank" rel="noreferrer">
              {short(s.tx, 8, 6)} ↗
            </a>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The one cross-chain loop that is not among the measured 31: what happened, step by step, from chain data.
 * The protocol part (user paid, relayer reimbursed, fill closed) finished; the harness's own cleanup then ran out of gas.
 */
export function CaseStudyView({ study }: { study: CaseStudy }) {
  const protocol = study.steps.filter((s) => !s.key.startsWith("restore"));
  const harness = study.steps.filter((s) => s.key.startsWith("restore"));
  const originTs = study.steps[0]?.ts ?? null;
  const f = study.failure;
  const pct = Math.round((f.gasUsed / f.gasLimit) * 100);

  return (
    <div className="cs">
      <div className="sl-grid cs-counts">
        <div className="sl-card">
          <h3>Completed on-chain</h3>
          <div className="sl-big">
            {study.counts.completedOnChain}/{study.counts.attempted}
          </div>
          <p className="sl-note">every cross-chain loop paid the user and reimbursed the relayer</p>
        </div>
        <div className="sl-card">
          <h3>In the latency numbers</h3>
          <div className="sl-big">
            {study.counts.recorded}/{study.counts.attempted}
          </div>
          <p className="sl-note">the other one's timings were never saved</p>
        </div>
        <div className="sl-card">
          <h3>What failed</h3>
          <div className="sl-big">1 harness step</div>
          <p className="sl-note">the test tool's cleanup, not the protocol</p>
        </div>
      </div>

      <div className="cs-cols">
        <div className="sl-card">
          <h3>The protocol: what Sluice did</h3>
          <Steps steps={protocol} originTs={originTs} />
          <div className="cs-outcome">
            <span className="sl-status good">
              <span className="dot" aria-hidden="true" />✓ User paid {usdStr(study.outcome.userPaid)} mUSD
            </span>
            <span className="sl-status good">
              <span className="dot" aria-hidden="true" />✓ Relayer reimbursed {usdStr(study.outcome.relayerReimbursed)} mUSD
            </span>
            <span className="sl-status good">
              <span className="dot" aria-hidden="true" />✓ Fill ended {study.outcome.fillStage}
            </span>
          </div>

          <h3 className="cs-gap">The test harness: what failed</h3>
          <Steps steps={harness} originTs={originTs} />
          <p className="sl-note">Times are block timestamps relative to the first step: 1 s resolution, and the chains&apos; clocks differ by about a second.</p>
        </div>

        <div className="cs-side">
          <div className="sl-card">
            <h3>Why it failed</h3>
            <div className="sl-kv">
              <span>Call</span>
              <span className="sl-mono">{f.call}</span>
            </div>
            <div className="sl-kv">
              <span>Contract</span>
              <span>
                <a className="sl-link sl-mono" href={addrUrl("uni", f.contract)} target="_blank" rel="noreferrer">
                  SiblingVault {short(f.contract)}
                </a>
              </span>
            </div>
            <div className="sl-kv">
              <span>Gas used / limit</span>
              <span>
                {f.gasUsed.toLocaleString("en-US")} / {f.gasLimit.toLocaleString("en-US")} ({pct}%)
              </span>
            </div>
            <div className="sl-meter cs-full" role="img" aria-label={`${pct} percent of the gas limit used`}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <p className="sl-note">{f.cause}</p>
            <p className="sl-note">
              The harness threw before it built the loop's result, so the loop was recorded as failed with no timings. Nothing about the payout or the
              reimbursement was affected: both had already happened.
            </p>
            <a className="sl-link sl-mono" href={f.link} target="_blank" rel="noreferrer">
              failed transaction ↗
            </a>
          </div>

          <div className="sl-card">
            <h3>The fix, and the rerun</h3>
            <p className="sl-note cs-first">
              {study.fix.description} See{" "}
              <a className="sl-link" href={`${REPO}/${study.fix.file}`} target="_blank" rel="noreferrer">
                {study.fix.file}
              </a>
              .
            </p>
            {study.rerun.loops > 0 && (
              <>
                <p className="sl-note">
                  Rerun after the fix: <b>{study.rerun.succeeded} of {study.rerun.loops}</b> loops succeeded, published next to the original result.
                </p>
                <table className="sl-table">
                  <thead>
                    <tr>
                      <th>Loop</th>
                      <th className="num">User paid</th>
                      <th className="num">Reimbursed</th>
                      <th>Transactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {study.rerun.examples.map((e) => (
                      <tr key={e.loop}>
                        <td>#{e.loop}</td>
                        <td className="num">{secs(e.userPaidMs)}</td>
                        <td className="num">{secs(e.relayerReimbursedMs)}</td>
                        <td>
                          {(["origin", "front", "reimburse"] as const).map((k) =>
                            e.links[k] ? (
                              <span key={k}>
                                <a className="sl-link" href={e.links[k]} target="_blank" rel="noreferrer">
                                  {k} ↗
                                </a>{" "}
                              </span>
                            ) : null,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
