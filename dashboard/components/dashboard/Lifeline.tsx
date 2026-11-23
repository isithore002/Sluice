"use client";

import type { LifelineEvidence } from "../../lib/manifest";
import { txUrl, type ChainKey } from "../../lib/config";
import { chainName, chipClass, short } from "./format";

interface Step {
  key: string;
  label: string;
  chain: ChainKey;
  tx: string;
  /** Block timestamp, seconds. Both chains have 1 s resolution and their clocks differ by about a second. */
  ts: number | null;
}

const tsOf = (t: string): number | null => {
  const m = /ts (\d+)/.exec(t);
  return m ? Number(m[1]) : null;
};

function chainOf(t: string): ChainKey {
  return /^lasna/i.test(t) ? "lasna" : /^base/i.test(t) ? "base" : "uni";
}

function Steps({ steps }: { steps: Step[] }) {
  const t0 = steps.find((s) => s.ts !== null)?.ts ?? null;
  return (
    <ol className="cs-steps">
      {steps.map((s) => (
        <li key={s.key} className="cs-step ok">
          <span className="cs-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <div className="cs-title">
              {s.label}
              <span className={`sl-chip ${chipClass[s.chain]}`}>{chainName[s.chain]}</span>
              {s.ts !== null && t0 !== null && (
                <span className="cs-time" title="Block timestamps have 1 s resolution, and the chains' clocks differ by about a second">
                  +{Math.max(0, s.ts - t0)} s
                </span>
              )}
            </div>
            <a className="sl-link sl-mono" href={txUrl(s.chain, s.tx)} target="_blank" rel="noreferrer">
              {short(s.tx, 8, 6)} ↗
            </a>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Lifeline: what happens when Omni silently stops a contract for debt, and how Lifeline revives it. Everything here is read from
 * the two recorded live probes, so the panel adds no RPC load. The probes used throwaway contracts, not the Sluice contracts.
 */
export function LifelineView({ data }: { data: LifelineEvidence }) {
  const l = data.local.firstLoop;
  const localSteps: Step[] = [
    {
      key: "bl",
      label: "A contract with no lREACT is blacklisted by the network on its first reaction. Nothing reverts and nobody is told.",
      chain: "lasna",
      tx: l.blacklistEvent.tx,
      ts: l.blacklistEvent.timestamp,
    },
    {
      key: "rescue",
      label: `Lifeline pays its debt (${l.rescueTx_depositToInsideReact.debtBefore_lREACT} lREACT) plus a top-up from the sponsor's budget, from inside react()`,
      chain: "lasna",
      tx: l.rescueTx_depositToInsideReact.tx,
      ts: l.rescueTx_depositToInsideReact.timestamp,
    },
  ];

  const remoteSteps: Step[] = data.remote.timeline
    .filter((e) => e.tx)
    .map((e, i) => ({
      key: `r${i}`,
      label: e.event.replace(/;\s*proxy emits.*$/, "").replace(/^callback #1 delivered: /, "Callback #1 runs: "),
      chain: chainOf(e.t),
      tx: e.tx as string,
      ts: tsOf(e.t),
    }));

  return (
    <div className="cs">
      <p className="sl-note">
        On Omni, a contract whose debt is above zero is blacklisted and its <span className="sl-mono">react()</span> or callbacks just stop. For a withdrawal queue that is the worst
        failure there is. Lifeline watches the network&apos;s blacklist event for chosen contracts and revives them, spending only a budget its sponsor set in advance (a cap per rescue,
        a cooldown). Sluice&apos;s own contracts are untouched: these runs used probe contracts we deployed.
      </p>
      <div className="sl-grid cs-counts">
        <div className="sl-card">
          <h3>On Lasna</h3>
          <div className="sl-big">{l.blacklistToRescueSeconds} s</div>
          <p className="sl-note">blacklisted to revived, one block later</p>
        </div>
        <div className="sl-card">
          <h3>Across chains</h3>
          <div className="sl-big">≈ {data.remote.blacklistToRevivedSecondsApprox} s</div>
          <p className="sl-note">a Base recipient blacklisted by the real callback proxy, then revived and receiving callbacks again</p>
        </div>
      </div>
      <div className="cs-cols">
        <div>
          <h3 className="cs-h">Cross-chain: a callback recipient on Base Sepolia</h3>
          <Steps steps={remoteSteps} />
          <p className="sl-note">{data.remote.noteOnTiming}</p>
        </div>
        <div className="cs-side">
          <div className="sl-card">
            <h3>Reactive chain: a reactive contract on Lasna</h3>
            <Steps steps={localSteps} />
          </div>
          <div className="sl-card">
            <h3>What this does not show</h3>
            <ul className="sl-note">
              {data.local.notTested.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>A rescue restores delivery going forward. It does not replay events missed while the contract was halted.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
