/**
 * Builds results/replay-race.json: every recorded race round, plus the Omni (Lasna) transactions that reacted to its
 * repayment, so the dashboard can replay any round on one timeline (repayment, Omni's reaction, queue payout,
 * competitor withdrawal) with an explorer link for each transaction.
 *
 * Nothing is re-measured. The timings and outcomes come from the recorded race file; this script only looks up
 * which Lasna transactions handled each repayment (the events carry the repayment's hash as their trace id).
 *
 * Usage: npm run replay
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { base, rnk, txUrl } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import { RESULTS } from "./env.js";
import { blockAtOrBefore, eventsInRange, retry } from "./chainsearch.js";

const log = (s: string) => console.log(s);

type Round = {
  round: number;
  delayBlocks: number;
  competitorDelayS: number;
  sluiceBlock: string;
  competitorBlock: string;
  txs: { repay: string; competitor: string; sluice: string };
  [k: string]: unknown;
};

async function main() {
  const files = readdirSync(RESULTS)
    .filter((f) => /^race-\d{4}-.*\.json$/.test(f))
    .sort();
  const source = files[files.length - 1];
  if (!source) throw new Error("no race-*.json in results/: run `npm run race` first");
  const rounds = JSON.parse(readFileSync(resolve(RESULTS, source), "utf8")) as Round[];
  log(`Replay data from ${source}: ${rounds.length} rounds`);

  // Block of each repayment on Base (and the time span of the whole run).
  const repayBlock = new Map<string, bigint>();
  for (const r of rounds) {
    const rc = await retry(() => base.pub.getTransactionReceipt({ hash: r.txs.repay as `0x${string}` }));
    repayBlock.set(r.txs.repay, rc.blockNumber);
  }
  const blocks = [...repayBlock.values()].sort((a, b) => Number(a - b));
  const tsFirst = Number((await retry(() => base.pub.getBlock({ blockNumber: blocks[0] }))).timestamp);
  const tsLast = Number((await retry(() => base.pub.getBlock({ blockNumber: blocks[blocks.length - 1] }))).timestamp);

  // The matching Lasna block range (a little before the first repayment, well after the last one).
  const lo = await blockAtOrBefore(rnk, tsFirst - 20);
  const hi = await blockAtOrBefore(rnk, tsLast + 120);
  log(`  Lasna blocks ${lo}..${hi}`);

  const fetchEvents = (eventName: string) =>
    eventsInRange(
      (from, to) =>
        rnk.pub.getContractEvents({ address: ADDR.reactive, abi: ABI.reactive, eventName, fromBlock: from, toBlock: to } as never) as Promise<
          { args: Record<string, unknown>; transactionHash: string; blockNumber: bigint }[]
        >,
      lo,
      hi,
    );
  const [requested, scheduled] = await Promise.all([fetchEvents("PullRequested"), fetchEvents("PullScheduled")]);
  log(`  ${requested.length} PullRequested and ${scheduled.length} PullScheduled events`);

  const byTrace = (evs: typeof requested) => {
    const m = new Map<bigint, typeof requested>();
    for (const e of evs) m.set(e.args.traceId as bigint, [...(m.get(e.args.traceId as bigint) ?? []), e]);
    return m;
  };
  const req = byTrace(requested);
  const sch = byTrace(scheduled);

  const seen = new Map<string, number>();
  let linked = 0;
  const out = rounds.map((r) => {
    const trace = BigInt(r.txs.repay);
    const pulled = req.get(trace)?.[0];
    const delayed = sch.get(trace)?.[0];
    // Native speed: one Lasna transaction both reacts and requests the pull. +6 blocks: it first schedules the pull,
    // and a Cron transaction six blocks later requests it.
    const reacted = r.delayBlocks === 0 ? pulled : delayed;
    if (reacted && pulled) linked++;

    const cell = `${r.delayBlocks}|${r.competitorDelayS}`;
    const index = (seen.get(cell) ?? 0) + 1;
    seen.set(cell, index);

    const txs: Record<string, string> = { ...r.txs };
    if (reacted) txs.reactive = reacted.transactionHash;
    if (pulled) txs.reactiveRequested = pulled.transactionHash;
    const links = Object.fromEntries(
      Object.entries(txs).map(([k, h]) => [k, txUrl(k === "reactive" || k === "reactiveRequested" ? rnk : base, h)]),
    );
    return {
      ...r,
      index,
      txs,
      links,
      chain: {
        repayBlock: repayBlock.get(r.txs.repay)!.toString(),
        sluiceBlock: r.sluiceBlock,
        competitorBlock: r.competitorBlock,
        reactiveBlock: reacted?.blockNumber.toString(),
        requestedBlock: pulled?.blockNumber.toString(),
      },
    };
  });

  log(`  linked an Omni reaction to ${linked} of ${rounds.length} rounds`);
  if (linked < rounds.length) log("  (rounds without a link keep their recorded timings; only the Lasna transaction is missing)");
  writeFileSync(resolve(RESULTS, "replay-race.json"), JSON.stringify({ generatedAt: new Date().toISOString(), source, rounds: out }, null, 2));
  log(`wrote results/replay-race.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
