/**
 * Summarize every results/*.json into results/summary.json and results/SUMMARY.md.
 * Usage: npm run summary
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RESULTS } from "./env.js";
import { stats } from "./util.js";

function load(prefix: string): any[] {
  return readdirSync(RESULTS)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(resolve(RESULTS, f), "utf8")) as any[]);
}

const fmt = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "n/a");

const b = load("flowB-");
const c = load("flowC-");
const race = load("race-");

const bOk = b.filter((r) => r.ok);
const cOk = c.filter((r) => r.ok);

const summary = {
  generatedAt: new Date().toISOString(),
  flowB: {
    attempted: b.length,
    succeeded: bOk.length,
    totalWallMs: stats(bOk.map((r) => r.wallMs.total)),
    originToReactiveWallMs: stats(bOk.map((r) => r.wallMs.originToReactive)),
    reactiveToCallbackWallMs: stats(bOk.map((r) => r.wallMs.reactiveToCallback)),
    totalChainSeconds: stats(bOk.map((r) => r.chainSeconds.total)),
    example: bOk[0]?.links ?? null,
  },
  flowC: {
    attempted: c.length,
    succeeded: cOk.length,
    userPaidWallMs: stats(cOk.map((r) => r.wallMs.userPaid)),
    relayerReimbursedWallMs: stats(cOk.map((r) => r.wallMs.relayerReimbursed)),
    userPaidChainSeconds: stats(cOk.map((r) => r.chainSeconds.userPaid)),
    example: cOk[0]?.links ?? null,
  },
  race: [] as any[],
};

const cells = new Map<string, any[]>();
for (const r of race.filter((r) => r.capture !== undefined)) {
  const k = `${r.delayBlocks}|${r.competitorDelayS}`;
  cells.set(k, [...(cells.get(k) ?? []), r]);
}
for (const [k, rs] of [...cells.entries()].sort()) {
  const [delayBlocks, competitorDelayS] = k.split("|").map(Number);
  summary.race.push({
    delayBlocks,
    competitorDelayS,
    rounds: rs.length,
    meanCapture: rs.reduce((s, r) => s + r.capture, 0) / rs.length,
    sluiceActedMs: stats(rs.map((r) => r.sluiceActedAfterMs).filter((v) => v !== null)),
  });
}

writeFileSync(resolve(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));

const md: string[] = [];
md.push("# Sluice measurement summary", "", `Generated ${summary.generatedAt}.`, "");
md.push("## Flow B: Morpho repayment → queue paid (one reactive hop)", "");
md.push(`Succeeded ${bOk.length}/${b.length}.`, "");
md.push("| Measure | Median | p95 | Max |", "|---|---|---|---|");
const row = (name: string, s: ReturnType<typeof stats>) => md.push(`| ${name} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.max)} |`);
row("Repay → queue paid (wall clock)", summary.flowB.totalWallMs);
row("Repay → Lasna react (wall clock)", summary.flowB.originToReactiveWallMs);
row("Lasna react → Base callback (wall clock)", summary.flowB.reactiveToCallbackWallMs);
md.push(
  `| Repay → queue paid (block timestamps, 1 s resolution) | ${summary.flowB.totalChainSeconds.median} s | ${summary.flowB.totalChainSeconds.p95} s | ${summary.flowB.totalChainSeconds.max} s |`,
  "",
);
md.push("## Flow C: Base shortfall → fronted by reserve, reimbursed on Unichain", "");
md.push(`Succeeded ${cOk.length}/${c.length}.`, "");
md.push("| Measure | Median | p95 | Max |", "|---|---|---|---|");
row("Request → user paid (wall clock)", summary.flowC.userPaidWallMs);
row("Request → relayer reimbursed (wall clock)", summary.flowC.relayerReimbursedWallMs);
md.push("");
md.push("## Latency race: share of contested liquidity captured by the queue", "");
md.push("| Sluice speed | Competitor delay | Rounds | Queue capture | Sluice acted (median) |", "|---|---|---|---|---|");
for (const r of summary.race) {
  const speed = r.delayBlocks === 0 ? "Omni native" : `+${r.delayBlocks} Lasna blocks (~legacy)`;
  md.push(`| ${speed} | ${r.competitorDelayS} s | ${r.rounds} | ${(r.meanCapture * 100).toFixed(0)}% | ${fmt(r.sluiceActedMs.median)} |`);
}
md.push(
  "",
  "Wall-clock times are measured by the harness polling every ~150 ms, so each includes up to one poll interval of observation delay. The ~legacy rows add delay on Omni; they are not runs on the legacy network.",
);
writeFileSync(resolve(RESULTS, "SUMMARY.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
