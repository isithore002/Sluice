/**
 * Flow B latency: a Morpho repayment (in a market Sluice doesn't control) pays a queued withdrawal through Reactive.
 * Each loop: queue X -> repay X on Morpho (t0) -> Lasna react() (t1) -> Base pullFromMorpho settles the queue (t2).
 * Usage: npm run flowB -- --n 30 --x 10
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { base, rnk, txUrl } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { RESULTS, flag } from "./env.js";
import { allEvents, blockTime, stats, usdUnits, waitForEvent } from "./util.js";

const N = Number(flag("n", "30"));
const X = usdUnits(Number(flag("x", "10")));
const log = (s: string) => console.log(s);

async function loop(i: number) {
  const fromBase = await base.pub.getBlockNumber();
  const fromLasna = await rnk.pub.getBlockNumber();

  await act.requestWithdraw(X); // queued: the market is at 100% utilization
  const origin = await act.repay(X);
  const trace = BigInt(origin.hash);

  const [handled, settled] = await Promise.all([
    waitForEvent({ c: rnk, address: ADDR.reactive, abi: ABI.reactive, eventName: "Handled", fromBlock: fromLasna, args: { traceId: trace } }),
    waitForEvent({
      c: base,
      address: ADDR.vault,
      abi: ABI.vault,
      eventName: "WithdrawSettled",
      fromBlock: fromBase,
      match: (a) => a.traceId === trace,
    }),
  ]);
  if (!handled || !settled) throw new Error(`loop ${i}: timeout (handled=${!!handled}, settled=${!!settled})`);

  const paid = (
    await allEvents({ c: base, address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: fromBase, match: (a) => a.traceId === trace })
  ).reduce((s, l) => s + (l.args.paid as bigint), 0n);

  const [tsOrigin, tsReactive, tsCallback] = await Promise.all([
    blockTime(base, origin.blockNumber),
    blockTime(rnk, handled.log.blockNumber),
    blockTime(base, settled.log.blockNumber),
  ]);

  // Restore: the paid assets go back into the vault (supplied to Morpho), then get borrowed again.
  await act.deposit(paid);
  await act.borrow(paid);

  return {
    flow: "B",
    i,
    ok: true,
    x: X.toString(),
    paid: paid.toString(),
    txs: { origin: origin.hash, reactive: handled.log.transactionHash, callback: settled.log.transactionHash },
    links: {
      origin: txUrl(base, origin.hash),
      reactive: txUrl(rnk, handled.log.transactionHash!),
      callback: txUrl(base, settled.log.transactionHash!),
    },
    blocks: {
      origin: origin.blockNumber.toString(),
      reactive: handled.log.blockNumber?.toString(),
      callback: settled.log.blockNumber?.toString(),
    },
    chainSeconds: { origin: tsOrigin, reactive: tsReactive, callback: tsCallback, total: tsCallback! - tsOrigin! },
    wallMs: {
      total: settled.seenAt - origin.seenAt,
      originToReactive: handled.seenAt - origin.seenAt,
      reactiveToCallback: settled.seenAt - handled.seenAt,
    },
  };
}

async function main() {
  log(`Flow B: ${N} loops of ${Number(X) / 1e6} mUSD`);
  await act.setMode({ crossChain: false, delay: 0n }, log);
  await act.normalize(log);

  const out = resolve(RESULTS, `flowB-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results: unknown[] = [];
  for (let i = 0; i < N; i++) {
    try {
      const r = await loop(i);
      results.push(r);
      log(`  #${i} ok  total ${r.wallMs.total} ms (chain ${r.chainSeconds.total}s)  origin->react ${r.wallMs.originToReactive} ms`);
    } catch (e) {
      results.push({ flow: "B", i, ok: false, error: String(e) });
      log(`  #${i} FAILED: ${e}`);
      await act.normalize(log);
    }
    writeFileSync(out, JSON.stringify(results, null, 2));
  }

  const ok = results.filter((r: any) => r.ok) as any[];
  const s = stats(ok.map((r) => r.wallMs.total));
  log(`\nsuccess ${ok.length}/${N}   total wall ms: median ${s.median}, p95 ${s.p95}, max ${s.max}`);
  log(`results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
