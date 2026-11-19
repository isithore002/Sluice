/**
 * Batch continuation: ONE Morpho repayment settles MORE queued withdrawals than a single callback may pay.
 *
 * The vault pays at most MAX_FILLS_PER_CALL (25) requests per callback, so a repayment that frees cash for 40 queued
 * withdrawals needs two. This run proves Reactive schedules the second one by itself: N separate lender wallets
 * deposit, the market is drained back to 100% utilization, every lender queues a withdrawal, then a single
 * repayment frees cash for all of them. Nobody deposits again and nobody calls anything afterwards.
 *
 * Everything recorded is read back from chain events: which callback paid which requests, in which order, how much
 * gas each used against the 1.5M limit, and which Lasna transactions asked for each batch.
 *
 * Usage: npm run batch -- --n 40 --each 1
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { base, rnk, txUrl } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { asActor, ensureAllowance, ensureBalance, type Actor } from "./actors.js";
import { RESULTS, ROOT, flag } from "./env.js";
import { eventsInRange } from "./chainsearch.js";
import { allEvents, blockTime, fmtUsd, read, send, sleep, usdUnits } from "./util.js";

const N = Number(flag("n", "40"));
const EACH = usdUnits(Number(flag("each", "1")));
const TOTAL = EACH * BigInt(N);
const WALLETS_FILE = resolve(ROOT, "harness", ".batch-wallets.json");
/** 0.00002 ETH per lender wallet: at Base Sepolia's ~0.006 gwei that is many times what four transactions cost. */
const GAS_FUND = 20_000_000_000_000n;
const CONCURRENCY = 5;
const PULL_GAS = 1_500_000;
const log = (s: string) => console.log(s);

function walletKeys(n: number): Hex[] {
  const keys: Hex[] = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, "utf8")) : [];
  while (keys.length < n) keys.push(generatePrivateKey());
  writeFileSync(WALLETS_FILE, JSON.stringify(keys, null, 2)); // gitignored; testnet dust only
  return keys.slice(0, n);
}

async function inChunks<T>(items: T[], size: number, fn: (x: T, i: number) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((x, j) => fn(x, i + j)));
  }
}

/** Public RPCs drop the odd connection ("fetch failed"). Evidence reads are idempotent, so just try again. */
async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await sleep(400 * 2 ** i);
    }
  }
}

/**
 * Run a transaction step until its on-chain effect is visible. Checking before the first attempt makes the step
 * skippable on a resumed run; checking after an error covers a send whose response timed out but that was mined.
 */
async function ensure(isDone: () => Promise<boolean>, doIt: () => Promise<unknown>, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    if (await withRetry(isDone)) return;
    try {
      await doIt();
    } catch (e) {
      log(`  step failed (${String(e).split("\n")[0].slice(0, 110)}); checking the chain, then retrying`);
      await sleep(4_000);
    }
  }
  if (!(await withRetry(isDone))) throw new Error(`step did not complete after ${attempts} attempts`);
}

const sharesOf = (who: string) => read<bigint>(base, ADDR.vault, ABI.vault, "sharesOf", [who]);

/** The live queue: every request from `head` on that still has something owed. */
async function liveQueue(): Promise<{ id: number; owner: string }[]> {
  const [head, len] = await Promise.all([
    withRetry(() => read<bigint>(base, ADDR.vault, ABI.vault, "head")),
    withRetry(() => read<bigint>(base, ADDR.vault, ABI.vault, "queueLength")),
  ]);
  const out: { id: number; owner: string }[] = [];
  for (let id = Number(head); id < Number(len); id++) {
    const [owner, remaining] = await withRetry(() => read<readonly [string, bigint]>(base, ADDR.vault, ABI.vault, "request", [BigInt(id)]));
    if (remaining > 0n) out.push({ id, owner });
  }
  return out;
}

/** The market back at 100% utilization: borrow any free liquidity (deposits create some). */
async function drain() {
  const l = await act.liquidity();
  if (l > 0n) {
    log(`  borrowing ${l} free liquidity`);
    await act.borrow(l);
  }
}

/** Queue entries ids first..first+n-1 with the transaction that queued each, read back from WithdrawQueued events. */
async function queuedRequests(first: number, n: number) {
  const latest = await withRetry(() => base.pub.getBlockNumber());
  const events = await eventsInRange(
    (from, to) =>
      base.pub.getContractEvents({ address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawQueued", fromBlock: from, toBlock: to } as never) as Promise<
        { args: Record<string, unknown>; transactionHash: Hex }[]
      >,
    latest - 2_000n,
    latest,
    150n,
  );
  const byId = new Map(events.map((e) => [Number(e.args.requestId), e]));
  const out: { requestId: number; owner: string; tx: Hex; link: string }[] = [];
  for (let id = first; id < first + n; id++) {
    const e = byId.get(id);
    if (!e) throw new Error(`no WithdrawQueued event found for request ${id} in the last 2000 blocks`);
    out.push({ requestId: id, owner: String(e.args.owner), tx: e.transactionHash, link: txUrl(base, e.transactionHash) });
  }
  return out;
}

async function fundGas(lenders: Actor[]) {
  const hashes: Hex[] = [];
  for (const a of lenders) {
    const bal = await base.pub.getBalance({ address: a.address });
    if (bal >= GAS_FUND / 2n) continue;
    hashes.push(await base.wallet.sendTransaction({ to: a.address, value: GAS_FUND }));
  }
  await Promise.all(hashes.map((hash) => base.pub.waitForTransactionReceipt({ hash })));
  log(`  funded gas for ${hashes.length} of ${lenders.length} wallets`);
}

async function main() {
  const cap = Number(await read<bigint>(base, ADDR.vault, ABI.vault, "MAX_FILLS_PER_CALL"));
  log(`Batch continuation: ${N} lenders queue ${fmtUsd(EACH)} mUSD each, then ONE repayment of ${fmtUsd(TOTAL)} mUSD`);
  log(`  the vault pays at most ${cap} requests per callback, so ${Math.ceil(N / cap)} callbacks are needed`);

  await act.setMode({ crossChain: false, delay: 0n }, log); // isolate the Morpho path

  const lenders = walletKeys(N).map(asActor);
  const lenderAddrs = lenders.map((a) => a.address.toLowerCase());

  // Staging is resumable: a public RPC can time out on a transaction that was in fact mined, so every step checks
  // on-chain state first and re-checks after any error. A queue that already holds a prefix of our lenders, in
  // order, is a half-finished run of this very script and is continued instead of being paid out.
  const live = await liveQueue();
  const resumed = live.length > 0 && live.every((q, i) => q.owner.toLowerCase() === lenderAddrs[i]);
  if (resumed) {
    log(`  resuming: ${live.length} of ${N} lenders are already queued (ids ${live[0].id}..${live[live.length - 1].id})`);
    await drain();
  } else {
    await act.normalize(log); // nobody queued, market at 100% utilization
  }
  const alreadyQueued = new Set(live.map((q) => q.owner.toLowerCase()));

  // ----- 1. stage: N separate lenders deposit, then the market is drained again ---------------------------------
  await fundGas(lenders);
  let staged = 0;
  await inChunks(lenders, CONCURRENCY, async (a) => {
    if (!alreadyQueued.has(a.address.toLowerCase())) {
      await ensure(
        async () => (await sharesOf(a.address)) >= EACH,
        async () => {
          await ensureBalance(a, EACH);
          await ensureAllowance(a, ADDR.vault, EACH);
          await send(a, ADDR.vault, ABI.vault, "deposit", [EACH]);
        },
      );
    }
    staged++;
    if (staged % 10 === 0 || staged === N) log(`  ${staged}/${N} lenders have deposited`);
  });
  await drain(); // borrow the free liquidity the deposits created

  // ----- 2. queue them one by one, in wallet order, so request ids follow the wallets ---------------------------
  let requested = 0;
  for (let i = 0; i < N; i++) {
    const a = lenders[i];
    if (!alreadyQueued.has(a.address.toLowerCase())) {
      // Phase 1 guarantees every lender not yet queued holds EACH shares, so fewer shares means "already requested".
      await ensure(
        async () => (await sharesOf(a.address)) < EACH,
        async () => {
          await send(a, ADDR.vault, ABI.vault, "requestWithdraw", [EACH]);
        },
      );
    }
    requested++;
    if (requested % 10 === 0 || requested === N) log(`  ${requested}/${N} withdrawals queued`);
  }
  const finalQueue = await liveQueue();
  if (finalQueue.length !== N || finalQueue.some((q, i) => q.owner.toLowerCase() !== lenderAddrs[i])) {
    throw new Error(`the queue does not hold exactly our ${N} lenders in order (it holds ${finalQueue.length} entries)`);
  }
  const firstId = finalQueue[0].id;
  const queued = await queuedRequests(firstId, N);
  const pendingNow = await act.pending();
  if (pendingNow !== TOTAL) throw new Error(`expected ${TOTAL} pending, vault says ${pendingNow}`);
  if ((await act.shortfall()) !== TOTAL) throw new Error("expected the whole queue to be a shortfall (nothing reachable)");
  log(`  queue: ${N} requests (ids ${firstId}..${firstId + N - 1}), ${fmtUsd(pendingNow)} mUSD pending, nothing reachable`);

  // Reactive must have seen the queue (its cache drives the decision to pull) before the repayment lands.
  for (let t = 0; t < 120; t++) {
    const cached = await read<bigint>(rnk, ADDR.reactive, ABI.reactive, "pending");
    if (cached === TOTAL) break;
    if (t === 119) throw new Error(`Reactive's pending cache is ${cached}, expected ${TOTAL}`);
    await sleep(500);
  }

  // ----- 3. ONE repayment, then watch --------------------------------------------------------------------------
  await act.mintUsd(TOTAL); // the borrower needs the cash to repay with
  const fromBase = await base.pub.getBlockNumber();
  const fromLasna = await rnk.pub.getBlockNumber();
  log(`\nRepaying ${fmtUsd(TOTAL)} mUSD in Morpho (one transaction)...`);
  const repay = await act.repay(TOTAL);
  const trace = BigInt(repay.hash);
  const t0 = repay.seenAt;
  log(`  repay tx ${repay.hash}`); // printed at once: if anything below fails, the run can still be found on-chain

  const marks: { batch1?: number; done?: number } = {};
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let head: bigint;
    let pend: bigint;
    try {
      [head, pend] = await Promise.all([read<bigint>(base, ADDR.vault, ABI.vault, "head"), act.pending()]);
    } catch {
      await sleep(200); // a dropped poll must not end the measurement
      continue;
    }
    const now = Date.now();
    if (marks.batch1 === undefined && head >= BigInt(firstId + cap)) marks.batch1 = now;
    if (pend === 0n) {
      marks.done = now;
      break;
    }
    await sleep(100);
  }
  if (marks.done === undefined) throw new Error("timeout: the queue was not fully paid within 120 s");
  log(`  first batch paid ${marks.batch1 !== undefined ? marks.batch1 - t0 : "?"} ms after the repayment`);
  log(`  queue empty ${marks.done - t0} ms after the repayment`);

  // ----- 4. read the evidence back from chain events -----------------------------------------------------------
  const settled = (
    await withRetry(() =>
      allEvents({ c: base, address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: fromBase, match: (a) => a.traceId === trace }),
    )
  ).sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);

  const ids = settled.map((l) => Number(l.args.requestId));
  const fifoOk = ids.length === N && ids.every((id, i) => id === firstId + i);

  // Group the payments by the callback transaction that made them.
  const byTx = new Map<string, typeof settled>();
  for (const l of settled) byTx.set(l.transactionHash!, [...(byTx.get(l.transactionHash!) ?? []), l]);
  const repayBlockTs = await withRetry(() => blockTime(base, repay.blockNumber));
  const callbacks = [];
  let batchNo = 0;
  for (const [tx, logs] of byTx) {
    const receipt = await withRetry(() => base.pub.getTransactionReceipt({ hash: tx as Hex }));
    const ts = await withRetry(() => blockTime(base, receipt.blockNumber));
    batchNo++;
    callbacks.push({
      batch: batchNo,
      tx,
      link: txUrl(base, tx),
      block: receipt.blockNumber.toString(),
      chainSecondsAfterRepay: ts! - repayBlockTs!,
      payments: logs.length,
      firstRequestId: Number(logs[0].args.requestId),
      lastRequestId: Number(logs[logs.length - 1].args.requestId),
      gasUsed: Number(receipt.gasUsed),
      gasLimitRequested: PULL_GAS,
    });
  }

  const pulls = await withRetry(() =>
    allEvents({ c: rnk, address: ADDR.reactive, abi: ABI.reactive, eventName: "PullRequested", fromBlock: fromLasna, match: (a) => a.traceId === trace }),
  );
  const reactive = [];
  for (const l of pulls) {
    reactive.push({
      tx: l.transactionHash,
      link: txUrl(rnk, l.transactionHash!),
      block: l.blockNumber!.toString(),
      attempt: Number(l.args.attempt),
      chainSecond: await withRetry(() => blockTime(rnk, l.blockNumber)),
    });
  }

  // Forty balance reads at once tripped a dropped connection on the public RPC, so read them a few at a time.
  const paidOut: { requestId: number; owner: string; balance: string }[] = [];
  await inChunks(lenders, CONCURRENCY, async (a, i) => {
    const bal = await withRetry(() => read<bigint>(base, ADDR.usd, ABI.usd, "balanceOf", [a.address]));
    paidOut[i] = { requestId: firstId + i, owner: a.address, balance: bal.toString() };
  });
  const allPaid = paidOut.every((p) => BigInt(p.balance) === EACH);

  const ok = fifoOk && allPaid && callbacks.length === Math.ceil(N / cap) && callbacks.every((c) => c.payments <= cap);
  const result = {
    flow: "D",
    ok,
    date: new Date().toISOString(),
    n: N,
    each: EACH.toString(),
    total: TOTAL.toString(),
    cap,
    firstRequestId: firstId,
    txs: { repay: repay.hash },
    links: { repay: txUrl(base, repay.hash) },
    callbacks,
    reactive,
    timing: {
      repayToFirstBatchMs: marks.batch1 !== undefined ? marks.batch1 - t0 : null,
      repayToQueueEmptyMs: marks.done - t0,
      firstBatchToQueueEmptyMs: marks.batch1 !== undefined ? marks.done - marks.batch1 : null,
    },
    fifo: { ok: fifoOk, ids },
    allLendersPaidInFull: allPaid,
    queued,
  };
  const out = resolve(RESULTS, `batch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2));

  log(`\n${ok ? "OK" : "PROBLEM"}: ${N} withdrawals, ${callbacks.length} callbacks, FIFO ${fifoOk ? "verified" : "BROKEN"}, all lenders paid ${allPaid ? "in full" : "NOT in full"}`);
  for (const c of callbacks) {
    log(`  callback ${c.batch}: ${c.payments} payments (ids ${c.firstRequestId}..${c.lastRequestId})  gas ${c.gasUsed.toLocaleString("en-US")} of ${PULL_GAS.toLocaleString("en-US")}  ${c.link}`);
  }
  log(`  repay -> first batch ${result.timing.repayToFirstBatchMs} ms, repay -> queue empty ${result.timing.repayToQueueEmptyMs} ms`);
  log(`results: ${out}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
