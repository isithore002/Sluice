"use client";

import type { Stats, Summary } from "../../lib/manifest";
import { secs } from "./format";

function StatRow({ name, s, sub }: { name: string; s: Stats; sub?: boolean }) {
  return (
    <tr>
      <td className={sub ? "dash-sub" : undefined}>{name}</td>
      <td className="num">{secs(s.median)}</td>
      <td className="num">{secs(s.p95)}</td>
      <td className="num">{secs(s.max)}</td>
      <td className="num">{s.n}</td>
    </tr>
  );
}

/** Measured latency of each live loop, traced end to end by the origin transaction hash. */
export function LatencyTable({ summary }: { summary: Summary }) {
  const { flowB, flowC, independent } = summary;
  return (
    <div className="sl-card sl-scroll">
      <table className="sl-table">
        <thead>
          <tr>
            <th>Loop</th>
            <th className="num">Median</th>
            <th className="num">p95</th>
            <th className="num">Max</th>
            <th className="num">Loops</th>
          </tr>
        </thead>
        <tbody>
          {flowB.succeeded > 0 && <StatRow name="Morpho repay → queue paid" s={flowB.totalWallMs} />}
          {flowB.succeeded > 0 && flowB.totalBlockMs && <StatRow name="by Base block numbers (× 200 ms)" s={flowB.totalBlockMs} sub />}
          {flowB.succeeded > 0 && <StatRow name="repay → Lasna react" s={flowB.originToReactiveWallMs} sub />}
          {flowC.succeeded > 0 && <StatRow name="Shortfall → user paid by reserve" s={flowC.userPaidWallMs} />}
          {flowC.succeeded > 0 && <StatRow name="Shortfall → relayer reimbursed (Unichain)" s={flowC.relayerReimbursedWallMs} />}
          {independent?.succeeded > 0 && <StatRow name="Outsider repay → queue paid (separate wallets)" s={independent.totalWallMs} />}
        </tbody>
      </table>
      <p className="sl-note">
        Success: flow B {flowB.succeeded}/{flowB.attempted}, flow C {flowC.succeeded}/{flowC.attempted}
        {flowC.succeeded < flowC.attempted && (
          <>
            {" "}
            (<a className="sl-link" href="#case">the one that is not counted, explained</a>)
          </>
        )}
        . Wall-clock times include up to ~150 ms of polling delay.
      </p>
    </div>
  );
}
