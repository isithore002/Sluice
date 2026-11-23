/**
 * Keeper baseline: a polling bot against Reactive, on the same live repayments.
 *
 * "Why not just run a keeper?" is the obvious question about any Reactive queue, so this measures it. Each round a
 * withdrawal is queued (the market is at 100% utilization), then the borrower repays on Morpho (t0). Two things can
 * pay the queue:
 *   - Reactive: SluiceReactive sees the Repay and its callback pulls from Morpho (traceId = the repay's tx hash);
 *   - a keeper: a bot that polls Morpho for free liquidity every `pollMs` milliseconds and, when it sees some while
 *     people are queued, sends the vault's permissionless `poke()` (traceId 0). It sends with a fixed gas limit and
 *     no estimation, like any bot that wants to be fast.
 * Whoever lands first pays the queue; the other finds nothing left to do. The winner is read back from the
 * WithdrawSettled event's traceId, so it is not a guess.
 *
 * The keeper runs on the same machine and the same public RPC as the harness, so it is a fair-but-not-best-case bot:
 * a co-located bot with a private RPC would be faster, and this says so.
 *
 * Usage: npm run keeper -- --rounds 15 --x 10 --polls 1000,250
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { base, txUrl } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { RESULTS, flag } from "./env.js";
import { allEvents, sleep, stats, usdUnits, waitForEvent } from "./util.js";

const ROUNDS = Number(flag("rounds", "15"));
const X = usdUnits(Number(flag("x", "10")));
const POLLS = flag("polls", "1000,250").split(",").map(Number);
const log = (s: string) => console.log(s);

async function prepareRound() {
  await act.normalize();
  await act.requestWithdraw(X); // no free liquidity, so this queues
}

async function round(pollMs: number, r: number) {
  await prepareRound();
  const fromBase = await base.pub.getBlockNumber();

  // The keeper starts watching BEFORE the repayment, as a real bot would, and knows nothing about when it will come.
  let stop = false;
  let keeperSeenAt: number | null = null;
  let keeperSentAt: number | null = null;
  let keeperTx: string | null = null;
  let keeperPolls = 0;
  const keeper = (async () => {
    while (!stop) {
      keeperPolls++;
      try {
        const free = await act.liquidity();
        if (free > 0n && !stop) {
          keeperSeenAt = Date.now();
          keeperSentAt = Date.now();
          keeperTx = await base.wallet.writeContract({
            address: ADDR.vault,
            abi: ABI.vault,
            functionName: "poke",
            args: [],
            gas: 600_000n,
          } as never);
          return;
        }
      } catch {
        /* a failed poll just means poll again */
      }
      await sleep(pollMs);
    }
  })();

  const origin = await act.repay(X);
  const trace = BigInt(origin.hash);

  // First payment of this queue, whoever sent it.
  const first = await waitForEvent({
    c: base,
    address: ADDR.vault,
    abi: ABI.vault,
    eventName: "WithdrawSettled",
    fromBlock: fromBase,
    timeoutMs: 40_000,
  });
  stop = true;
  await keeper;

  if (!first) throw new Error(`round ${r}: nobody paid the queue within 40 s`);
  const winner = (first.log.args.traceId as bigint) === trace ? "reactive" : (first.log.args.traceId as bigint) === 0n ? "keeper" : "other";
  const settled = await allEvents({
    c: base,
    address: ADDR.vault,
    abi: ABI.vault,
    eventName: "WithdrawSettled",
    fromBlock: fromBase,
  });
  const paid = settled.reduce((s, l) => s + (l.args.paid as bigint), 0n);

  return {
    round: r,
    pollMs,
    winner,
    repayToPaidMs: first.seenAt - origin.seenAt,
    keeperSawLiquidityAfterMs: keeperSeenAt ? keeperSeenAt - origin.seenAt : null,
    keeperPolls,
    paid: paid.toString(),
    txs: { repay: origin.hash, firstPayment: first.log.transactionHash ?? null, keeperPoke: keeperTx },
    links: { repay: txUrl(base, origin.hash) },
  };
}

async function main() {
  log(`Keeper baseline: ${ROUNDS} rounds per polling interval [${POLLS.join(", ")}] ms, X = ${Number(X) / 1e6} mUSD`);
  await act.setMode({ crossChain: false, delay: 0n }, log); // isolate the Morpho path, no delay mode
  await act.normalize(log);

  const out = resolve(RESULTS, `keeper-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results: any[] = [];
  for (const pollMs of POLLS) {
    for (let r = 0; r < ROUNDS; r++) {
      try {
        const res = await round(pollMs, r);
        results.push(res);
        log(`  poll ${pollMs} ms #${r}: ${res.winner} paid the queue ${res.repayToPaidMs} ms after the repayment`);
      } catch (e) {
        results.push({ round: r, pollMs, ok: false, error: String(e) });
        log(`  poll ${pollMs} ms #${r}: FAILED ${e}`);
      }
      // Whatever happened, put the system back to nobody queued and the market fully borrowed, and let the chain settle.
      try {
        await act.normalize();
      } catch (e) {
        log(`  normalize failed: ${e}`);
      }
      writeFileSync(out, JSON.stringify(results, null, 2));
    }
  }

  log("\nSummary");
  for (const pollMs of POLLS) {
    const rs = results.filter((x) => x.pollMs === pollMs && x.winner);
    const keeperWins = rs.filter((x) => x.winner === "keeper").length;
    const s = stats(rs.map((x) => x.repayToPaidMs));
    log(
      `  keeper polling every ${pollMs} ms: keeper won ${keeperWins}/${rs.length}, Reactive won ${rs.filter((x) => x.winner === "reactive").length}/${rs.length}; ` +
        `repay -> paid median ${s.median} ms, p95 ${s.p95} ms`,
    );
  }
  log(`results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
