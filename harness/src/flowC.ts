/**
 * Flow C latency: a withdrawal Base can't cover is fronted from the relayer reserve in one hop; the relayer is then
 * reimbursed on Unichain for exactly what it sent.
 * Each loop: queue X with a shortfall (t0) -> Lasna react() (t1) -> Base front pays the user (t2)
 *            -> Lasna sees Fronted -> Unichain reimburse (t4).
 * Usage: npm run flowC -- --n 30 --x 10
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { base, rnk, txUrl, uni } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { RESULTS, flag } from "./env.js";
import { blockTime, stats, usdUnits, waitForEvent } from "./util.js";

const N = Number(flag("n", "30"));
const X = usdUnits(Number(flag("x", "10")));
const log = (s: string) => console.log(s);

async function ensureCrossChainFunds() {
  const need = X * 5n;
  if ((await act.inventory()) < need) {
    log(`  topping up reserve inventory by ${need}`);
    await act.mintUsd(need);
    await act.fundReserve(need);
  }
  if ((await act.credit()) < need) {
    log(`  topping up sibling credit by ${need}`);
    await act.mintUniUsd(need);
    await act.siblingDeposit(need);
    await act.commitCredit();
  }
}

async function loop(i: number) {
  const fromBase = await base.pub.getBlockNumber();
  const fromLasna = await rnk.pub.getBlockNumber();
  const fromUni = await uni.pub.getBlockNumber();

  const origin = await act.requestWithdraw(X); // queued with a shortfall: Morpho has no free liquidity
  const trace = BigInt(origin.hash);

  const [handled, settled, reimbursed] = await Promise.all([
    waitForEvent({ c: rnk, address: ADDR.reactive, abi: ABI.reactive, eventName: "Handled", fromBlock: fromLasna, args: { traceId: trace } }),
    waitForEvent({ c: base, address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: fromBase, match: (a) => a.traceId === trace }),
    waitForEvent({ c: uni, address: ADDR.sibling, abi: ABI.sibling, eventName: "Reimbursed", fromBlock: fromUni, match: (a) => a.traceId === trace, timeoutMs: 90_000 }),
  ]);
  if (!handled || !settled || !reimbursed) {
    throw new Error(`loop ${i}: timeout (handled=${!!handled}, settled=${!!settled}, reimbursed=${!!reimbursed})`);
  }

  const [tsOrigin, tsReactive, tsPaid, tsReimbursed] = await Promise.all([
    blockTime(base, origin.blockNumber),
    blockTime(rnk, handled.log.blockNumber),
    blockTime(base, settled.log.blockNumber),
    blockTime(uni, reimbursed.log.blockNumber),
  ]);
  const amount = reimbursed.log.args.amount as bigint;

  // Restore: refill the reserve (the user got X on Base), put X back in the vault and borrow it again, and put the
  // relayer's reimbursement back into the sibling vault as credit.
  await act.mintUsd(X);
  await act.fundReserve(X);
  await act.deposit(X);
  await act.borrow(X);
  await act.siblingDeposit(amount);
  await act.commitCredit();

  return {
    flow: "C",
    i,
    ok: true,
    x: X.toString(),
    reimbursed: amount.toString(),
    txs: {
      origin: origin.hash,
      reactive: handled.log.transactionHash,
      front: settled.log.transactionHash,
      reimburse: reimbursed.log.transactionHash,
    },
    links: {
      origin: txUrl(base, origin.hash),
      reactive: txUrl(rnk, handled.log.transactionHash!),
      front: txUrl(base, settled.log.transactionHash!),
      reimburse: txUrl(uni, reimbursed.log.transactionHash!),
    },
    chainSeconds: {
      origin: tsOrigin,
      reactive: tsReactive,
      paid: tsPaid,
      reimbursed: tsReimbursed,
      userPaid: tsPaid! - tsOrigin!,
      relayerReimbursed: tsReimbursed! - tsOrigin!,
    },
    wallMs: {
      userPaid: settled.seenAt - origin.seenAt,
      originToReactive: handled.seenAt - origin.seenAt,
      relayerReimbursed: reimbursed.seenAt - origin.seenAt,
    },
  };
}

async function main() {
  log(`Flow C: ${N} loops of ${Number(X) / 1e6} mUSD`);
  await act.setMode({ crossChain: true, delay: 0n }, log);
  await act.normalize(log);
  await ensureCrossChainFunds();

  const out = resolve(RESULTS, `flowC-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results: unknown[] = [];
  for (let i = 0; i < N; i++) {
    try {
      const r = await loop(i);
      results.push(r);
      log(`  #${i} ok  user paid ${r.wallMs.userPaid} ms (chain ${r.chainSeconds.userPaid}s)  relayer reimbursed ${r.wallMs.relayerReimbursed} ms`);
    } catch (e) {
      results.push({ flow: "C", i, ok: false, error: String(e) });
      log(`  #${i} FAILED: ${e}`);
      await act.normalize(log);
    }
    writeFileSync(out, JSON.stringify(results, null, 2));
  }

  const ok = results.filter((r: any) => r.ok) as any[];
  const s = stats(ok.map((r) => r.wallMs.userPaid));
  log(`\nsuccess ${ok.length}/${N}   user-paid wall ms: median ${s.median}, p95 ${s.p95}, max ${s.max}`);
  log(`results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
