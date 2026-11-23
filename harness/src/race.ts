/**
 * The latency race: when freed liquidity is contested, how much of it does the queue capture at Omni speed
 * (delayBlocks = 0) versus a simulated legacy-like speed (delayBlocks = 6, i.e. ~6 extra Lasna blocks)?
 *
 * Each round: X is queued and the market is at 100% utilization. The borrower repays X (t0). A competitor bot (a
 * lender in the same market) waits C seconds after seeing the repayment, then withdraws whatever is still free.
 * Sluice pulls for the queue through Reactive. Capture rate = queue payout traced to this repay / X.
 *
 * Usage: npm run race -- --rounds 10 --x 10 --delays 0,1,2,4,8 --speeds 0,6
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { base, txUrl } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { RESULTS, flag } from "./env.js";
import { allEvents, sleep, usdUnits, waitForEvent } from "./util.js";

const ROUNDS = Number(flag("rounds", "10"));
const X = usdUnits(Number(flag("x", "10")));
const DELAYS = flag("delays", "0,1,2,4,8").split(",").map(Number);
const SPEEDS = flag("speeds", "0,6").split(",").map((s) => BigInt(s));
const log = (s: string) => console.log(s);

/**
 * Start every round from the same state: nobody queued, market at 100% utilization, then exactly X queued.
 * `normalize` pays any leftover queue with a deposit and borrows any free liquidity, so the previous round never
 * leaks into this one. Nothing is "restored" after a round: each round shrinks Morpho supply and borrow equally,
 * and putting the competitor's winnings back would emit a Supply event that triggers Sluice outside the round.
 */
async function prepareRound() {
  await act.normalize();
  await act.requestWithdraw(X); // no free liquidity, so this queues
}

async function round(delayBlocks: bigint, competitorDelayS: number, r: number) {
  await prepareRound();
  const fromBase = await base.pub.getBlockNumber();

  const origin = await act.repay(X);
  const trace = BigInt(origin.hash);

  // Sluice always confirms its pull with StateUpdated(traceId), whether or not anything was left. Watch for it
  // from the moment of the repayment (concurrently with the competitor below), so the time Sluice acted is not
  // inflated by however long the competitor waited.
  const actedWatch = waitForEvent({
    c: base,
    address: ADDR.vault,
    abi: ABI.vault,
    eventName: "StateUpdated",
    fromBlock: fromBase,
    match: (a) => a.traceId === trace,
    timeoutMs: delayBlocks > 0n ? 60_000 : 40_000,
  });

  // Competitor: a bot that reacts C seconds after seeing the repayment. It fires a withdrawal of X immediately,
  // with no market read and no gas estimation (see competitorWithdrawFast). If Sluice already took the
  // liquidity the withdrawal reverts, which means the competitor lost.
  await sleep(Math.max(0, competitorDelayS * 1000 - (Date.now() - origin.seenAt)));
  const competitorSentAfterMs = Date.now() - origin.seenAt;
  let competitorGot = 0n;
  let competitorTx: string | null = null;
  let competitorOk = false;
  let competitorBlock: string | null = null;
  let competitorLandedAfterMs: number | null = null;
  let competitorError: string | null = null;
  try {
    const w = await act.competitorWithdrawFast(X);
    competitorTx = w.hash;
    competitorOk = w.ok;
    competitorBlock = w.blockNumber.toString();
    competitorLandedAfterMs = Date.now() - origin.seenAt;
    if (w.ok) competitorGot = X;
  } catch (e) {
    competitorError = String(e).split("\n")[0].slice(0, 200);
  }

  const acted = await actedWatch;
  const settled = await allEvents({
    c: base,
    address: ADDR.vault,
    abi: ABI.vault,
    eventName: "WithdrawSettled",
    fromBlock: fromBase,
    match: (a) => a.traceId === trace,
  });
  const sluiceGot = settled.reduce((s, l) => s + (l.args.paid as bigint), 0n);

  return {
    round: r,
    delayBlocks: Number(delayBlocks),
    competitorDelayS,
    x: X.toString(),
    sluiceGot: sluiceGot.toString(),
    competitorGot: competitorGot.toString(),
    capture: Number(sluiceGot) / Number(X),
    sluiceActedAfterMs: acted ? acted.seenAt - origin.seenAt : null,
    sluiceBlock: acted?.log.blockNumber?.toString() ?? null,
    competitorSentAfterMs,
    competitorLandedAfterMs,
    competitorOk,
    competitorBlock,
    competitorError,
    txs: { repay: origin.hash, competitor: competitorTx, sluice: settled[0]?.transactionHash ?? acted?.log.transactionHash ?? null },
    links: { repay: txUrl(base, origin.hash) },
  };
}

async function main() {
  log(`Race: ${ROUNDS} rounds x speeds [${SPEEDS.join(",")}] x competitor delays [${DELAYS.join(",")}]s, X = ${Number(X) / 1e6} mUSD`);
  await act.setMode({ crossChain: false, delay: 0n }, log);
  await act.normalize(log);

  const out = resolve(RESULTS, `race-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results: unknown[] = [];
  for (const speed of SPEEDS) {
    await act.setMode({ crossChain: false, delay: speed }, log);
    for (const c of DELAYS) {
      let captured = 0;
      for (let r = 0; r < ROUNDS; r++) {
        await act.assertReactiveHealthy(250_000_000_000_000_000n); // the legacy-like mode also pays for Cron ticks
        try {
          const res = await round(speed, c, r);
          results.push(res);
          captured += res.capture;
          log(`  delayBlocks=${speed} C=${c}s #${r}: queue got ${(res.capture * 100).toFixed(0)}% (Sluice acted at ${res.sluiceActedAfterMs} ms)`);
        } catch (e) {
          results.push({ round: r, delayBlocks: Number(speed), competitorDelayS: c, ok: false, error: String(e) });
          log(`  delayBlocks=${speed} C=${c}s #${r}: FAILED ${e}`);
          await act.normalize(log);
        }
        writeFileSync(out, JSON.stringify(results, null, 2));
      }
      log(`  => delayBlocks=${speed}, C=${c}s: mean capture ${((captured / ROUNDS) * 100).toFixed(0)}%`);
    }
  }
  await act.setMode({ crossChain: false, delay: 0n }, log);
  log(`results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
