/**
 * Summarize every results/*.json into results/summary.json and results/SUMMARY.md.
 * Usage: npm run summary
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const ind = load("independent-");

// Batch runs (flow D) and the cross-chain case study are single objects, not arrays of loops.
const batches = readdirSync(RESULTS)
  .filter((f) => /^batch-\d{4}-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(RESULTS, f), "utf8")));
const batchOk = batches.filter((x) => x.ok).pop() ?? null;
const caseFile = resolve(RESULTS, "case-study-flowC.json");
const caseStudy = existsSync(caseFile) ? JSON.parse(readFileSync(caseFile, "utf8")) : null;

const bOk = b.filter((r) => r.ok);
const cOk = c.filter((r) => r.ok);
const iOk = ind.filter((r) => r.ok);

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
  independent: {
    attempted: ind.length,
    succeeded: iOk.length,
    allIndependent: iOk.length > 0 && iOk.every((r) => r.independent),
    totalWallMs: stats(iOk.map((r) => r.wallMs.total)),
    example: iOk[0] ? { links: iOk[0].links, actors: iOk[0].actors } : null,
  },
  batch: batchOk
    ? {
        n: batchOk.n as number,
        cap: batchOk.cap as number,
        callbacks: (batchOk.callbacks as any[]).length,
        payments: (batchOk.callbacks as any[]).map((c) => c.payments as number),
        repayToFirstBatchMs: batchOk.timing.repayToFirstBatchMs as number | null,
        repayToQueueEmptyMs: batchOk.timing.repayToQueueEmptyMs as number,
        fifoOk: batchOk.fifo.ok as boolean,
        maxGasUsed: Math.max(...(batchOk.callbacks as any[]).map((c) => c.gasUsed as number)),
        gasLimit: (batchOk.callbacks as any[])[0].gasLimitRequested as number,
        each: batchOk.each as string,
        total: batchOk.total as string,
        firstRequestId: batchOk.firstRequestId as number,
        lastRequestId: (batchOk.firstRequestId as number) + (batchOk.n as number) - 1,
        reactiveLinks: (batchOk.reactive as any[]).map((r) => r.link as string),
        repayLink: batchOk.links.repay as string,
        callbackLinks: (batchOk.callbacks as any[]).map((c) => c.link as string),
      }
    : null,
  crossChainCaseStudy: caseStudy
    ? {
        attempted: caseStudy.counts.attempted as number,
        recorded: caseStudy.counts.recorded as number,
        completedOnChain: caseStudy.counts.completedOnChain as number,
        failedTx: caseStudy.failure.link as string,
        failedCall: caseStudy.failure.call as string,
        gasLimit: caseStudy.failure.gasLimit as number,
        gasUsed: caseStudy.failure.gasUsed as number,
      }
    : null,
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
md.push("## Independent actors: separate wallets for the user and the repayer", "");
md.push(`Succeeded ${iOk.length}/${ind.length}; every loop's repayment, withdrawal request and payout involved addresses other than the deployer: ${summary.independent.allIndependent}.`, "");
md.push("| Measure | Median | p95 | Max |", "|---|---|---|---|");
row("Repay (by an outsider) → queue paid (wall clock)", summary.independent.totalWallMs);
md.push("");
if (summary.batch) {
  const bt = summary.batch;
  md.push("## Batch continuation: one repayment, more queued withdrawals than one callback may pay", "");
  md.push(
    `${bt.n} withdrawals queued by ${bt.n} separate wallets, then ONE repayment. The vault pays at most ${bt.cap} per callback, so Reactive scheduled the next batch itself: ${bt.callbacks} callbacks (${bt.payments.join(" + ")} payments). ` +
      `Request ids were paid in strict FIFO order: ${bt.fifoOk}.`,
    "",
  );
  md.push("| Measure | Value |", "|---|---|");
  md.push(`| Repay → first batch paid (wall clock) | ${bt.repayToFirstBatchMs === null ? "n/a" : fmt(bt.repayToFirstBatchMs)} |`);
  md.push(`| Repay → queue empty (wall clock) | ${fmt(bt.repayToQueueEmptyMs)} |`);
  md.push(`| Largest callback gas / limit | ${bt.maxGasUsed.toLocaleString("en-US")} / ${bt.gasLimit.toLocaleString("en-US")} |`);
  md.push("");
}
if (summary.crossChainCaseStudy) {
  const cs = summary.crossChainCaseStudy;
  md.push("## The cross-chain loop that is not in the measured numbers", "");
  md.push(
    `${cs.completedOnChain} of ${cs.attempted} cross-chain loops completed on-chain (user paid, relayer reimbursed); ${cs.recorded} were measured. ` +
      `The other one finished correctly, then the harness's own cleanup call \`${cs.failedCall}\` ran out of gas (${cs.gasUsed.toLocaleString("en-US")} of ${cs.gasLimit.toLocaleString("en-US")}) before the loop's timings were saved. ` +
      `Full reconstruction in results/case-study-flowC.json and docs/CASE_STUDY_FLOW_C.md.`,
    "",
  );
}
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
