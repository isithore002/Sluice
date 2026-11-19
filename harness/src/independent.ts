/**
 * Independent-actor loops. Flow B again, but the roles are played by separate fresh wallets so no loop is triggered
 * by the deployer:
 *   - ALICE (a user): deposits into the vault and queues a withdrawal.
 *   - BOB (an outsider): repays on behalf of the borrower in Morpho (anyone can; Morpho needs no authorization).
 *   - The deployer wallet only funds their gas and remains the borrower whose debt Bob repays.
 * Reactive then pays Alice. Each record states the sender of every transaction and checks that it is not the deployer.
 * Usage: npm run independent -- --n 5 --x 10
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { base, rnk, txUrl } from "./chains.js";
import { actors, ensureAllowance, ensureBalance, ensureGas, type Actor } from "./actors.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { RESULTS, flag } from "./env.js";
import { allEvents, blockTime, send, stats, usdUnits, waitForEvent } from "./util.js";

const N = Number(flag("n", "5"));
const X = usdUnits(Number(flag("x", "10")));
const log = (s: string) => console.log(s);
const senderOf = async (hash: Hex) => (await base.pub.getTransaction({ hash })).from;

async function loop(i: number, alice: Actor, bob: Actor) {
  // Start clean: nobody queued, market fully borrowed (the deployer is the borrower and does this housekeeping).
  await act.normalize();

  // Alice deposits X (it becomes free liquidity), the borrower takes it back, then Alice queues a withdrawal.
  await ensureBalance(alice, X);
  await ensureAllowance(alice, ADDR.vault, X * 1000n);
  await send(alice, ADDR.vault, ABI.vault, "deposit", [X]);
  await act.normalize(); // borrows the liquidity Alice's deposit created
  const queuedTx = await send(alice, ADDR.vault, ABI.vault, "requestWithdraw", [X]);

  const fromBase = await base.pub.getBlockNumber();
  const fromLasna = await rnk.pub.getBlockNumber();

  // Bob, an outsider, repays on behalf of the borrower.
  await ensureBalance(bob, X);
  await ensureAllowance(bob, ADDR.morpho, X * 1000n);
  const params = await act.marketParams();
  const origin = await send(bob, ADDR.morpho, ABI.morpho, "repay", [params, X, 0n, act.me, "0x"]);
  const trace = BigInt(origin.hash);

  const [handled, settled] = await Promise.all([
    waitForEvent({ c: rnk, address: ADDR.reactive, abi: ABI.reactive, eventName: "Handled", fromBlock: fromLasna, args: { traceId: trace } }),
    waitForEvent({ c: base, address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: fromBase, match: (a) => a.traceId === trace }),
  ]);
  if (!handled || !settled) throw new Error(`loop ${i}: timeout (handled=${!!handled}, settled=${!!settled})`);

  const paidEvents = await allEvents({ c: base, address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: fromBase, match: (a) => a.traceId === trace });
  const paid = paidEvents.reduce((s, l) => s + (l.args.paid as bigint), 0n);
  const payee = settled.log.args.owner as Address;

  const [originFrom, callbackFrom, queuedFrom] = await Promise.all([
    senderOf(origin.hash),
    senderOf(settled.log.transactionHash as Hex),
    senderOf(queuedTx.hash),
  ]);
  const deployer = act.me.toLowerCase();
  const independent =
    originFrom.toLowerCase() !== deployer && queuedFrom.toLowerCase() !== deployer && payee.toLowerCase() !== deployer;

  const [tsOrigin, tsCallback] = await Promise.all([blockTime(base, origin.blockNumber), blockTime(base, settled.log.blockNumber)]);

  return {
    flow: "B-independent",
    i,
    ok: true,
    independent,
    x: X.toString(),
    paid: paid.toString(),
    actors: {
      deployerAndBorrower: act.me,
      aliceUser: alice.address,
      bobRepayer: bob.address,
      withdrawalQueuedBy: queuedFrom,
      repaymentSentBy: originFrom,
      payoutReceivedBy: payee,
      callbackSentBy: callbackFrom,
    },
    txs: { queued: queuedTx.hash, origin: origin.hash, reactive: handled.log.transactionHash, callback: settled.log.transactionHash },
    links: {
      queued: txUrl(base, queuedTx.hash),
      origin: txUrl(base, origin.hash),
      reactive: txUrl(rnk, handled.log.transactionHash!),
      callback: txUrl(base, settled.log.transactionHash!),
    },
    chainSeconds: { origin: tsOrigin, callback: tsCallback, total: tsCallback! - tsOrigin! },
    wallMs: { total: settled.seenAt - origin.seenAt, originToReactive: handled.seenAt - origin.seenAt },
  };
}

async function main() {
  log(`Independent actors: ${N} loops of ${Number(X) / 1e6} mUSD`);
  await act.setMode({ crossChain: false, delay: 0n }, log);
  const { alice, bob } = actors();
  log(`  Alice (user)    ${alice.address}\n  Bob (repayer)   ${bob.address}\n  deployer/borrower ${act.me}`);
  await ensureGas(alice.address, log);
  await ensureGas(bob.address, log);

  const out = resolve(RESULTS, `independent-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results: unknown[] = [];
  for (let i = 0; i < N; i++) {
    try {
      const r = await loop(i, alice, bob);
      results.push(r);
      log(`  #${i} ok  independent=${r.independent}  total ${r.wallMs.total} ms  repay by ${r.actors.repaymentSentBy.slice(0, 8)}…  paid to ${r.actors.payoutReceivedBy.slice(0, 8)}…`);
    } catch (e) {
      results.push({ flow: "B-independent", i, ok: false, error: String(e) });
      log(`  #${i} FAILED: ${e}`);
      await act.normalize(log);
    }
    writeFileSync(out, JSON.stringify(results, null, 2));
  }
  const ok = results.filter((r: any) => r.ok) as any[];
  const s = stats(ok.map((r) => r.wallMs.total));
  log(`\nsuccess ${ok.length}/${N}; all independent: ${ok.every((r) => r.independent)}; total wall ms median ${s.median}, p95 ${s.p95}`);
  log(`results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
