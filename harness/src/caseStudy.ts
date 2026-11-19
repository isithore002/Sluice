/**
 * Builds results/case-study-flowC.json: the one cross-chain loop that is not among the measured ones, reconstructed
 * from chain data so every step links to a real transaction.
 *
 * The recorded failure is "uni commitCredit reverted: <hash>". That is the harness's own cleanup step at the end of a
 * loop, so the loop's protocol steps had already happened: this script finds them (the Reimbursed event right before
 * the failed transaction carries the loop's trace id, which is the hash of its origin transaction) and then walks the
 * whole loop: origin on Base, Lasna reactions, payout on Base, reimbursement on Unichain, and the failed cleanup.
 *
 * Usage: npm run casestudy
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionData, type Hex } from "viem";
import { base, rnk, txUrl, uni, type ChainClients } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import { RESULTS, ROOT } from "./env.js";
import { blockAtOrBefore, retry } from "./chainsearch.js";
import { blockTime, fmtUsd } from "./util.js";

const log = (s: string) => console.log(s);
const STAGES = ["NONE", "FRONTING", "REIMBURSING", "DONE"];

type Step = {
  key: string;
  label: string;
  chain: "base" | "uni" | "lasna";
  tx: string;
  link: string;
  block: string;
  ts: number | null;
  status: "ok" | "failed";
  note?: string;
};

async function step(key: string, label: string, c: ChainClients, tx: string, block: bigint, status: Step["status"], note?: string): Promise<Step> {
  return { key, label, chain: c.name, tx, link: txUrl(c, tx), block: block.toString(), ts: await retry(() => blockTime(c, block)), status, note };
}

async function main() {
  const files = readdirSync(RESULTS)
    .filter((f) => /^flowC-\d{4}-.*\.json$/.test(f))
    .sort();
  const runs = files.map((f) => ({ file: f, rows: JSON.parse(readFileSync(resolve(RESULTS, f), "utf8")) as any[] }));
  const all = runs.flatMap((r) => r.rows);
  const failedRun = runs.find((r) => r.rows.some((x) => x.ok === false));
  if (!failedRun) throw new Error("no failed flow C loop found in results/: nothing to explain");
  const failed = failedRun.rows.filter((x) => x.ok === false);
  const first = failed[0];

  const m = /uni (\w+) reverted: (0x[0-9a-fA-F]{64})/.exec(String(first.error));
  if (!m) throw new Error(`cannot find a Unichain transaction hash in: ${first.error}`);
  const failHash = m[2] as Hex;
  log(`Failed loop #${first.i} in ${failedRun.file}: ${m[1]} reverted ${failHash}`);

  // ----- the failed transaction itself --------------------------------------------------------------------------
  const failTx = await retry(() => uni.pub.getTransaction({ hash: failHash }));
  const failRc = await retry(() => uni.pub.getTransactionReceipt({ hash: failHash }));
  const decoded = decodeFunctionData({ abi: ABI.sibling, data: failTx.input });
  const call = `${decoded.functionName}(${(decoded.args ?? []).join(", ")})`;
  const outOfGas = failRc.status === "reverted" && failRc.gasUsed === failTx.gas;
  log(`  ${call}: gas limit ${failTx.gas}, used ${failRc.gasUsed}, status ${failRc.status}`);
  if (!outOfGas) throw new Error("the failed transaction did not use its whole gas limit: this write-up assumes an out-of-gas revert");

  // ----- the loop it belonged to: the Reimbursed event just before it carries the trace id ----------------------
  const win = { fromBlock: failRc.blockNumber - 100n, toBlock: failRc.blockNumber };
  const reimbursed = (await retry(() => uni.pub.getContractEvents({ address: ADDR.sibling, abi: ABI.sibling, eventName: "Reimbursed", ...win } as never))) as any[];
  const deposited = (await retry(() => uni.pub.getContractEvents({ address: ADDR.sibling, abi: ABI.sibling, eventName: "Deposited", ...win } as never))) as any[];
  const rb = reimbursed[reimbursed.length - 1];
  if (!rb) throw new Error("no Reimbursed event shortly before the failed transaction: this was not an end-of-loop failure");
  const dp = deposited.filter((d) => d.transactionHash !== failHash).pop();
  const trace = rb.args.traceId as bigint;
  const fillId = rb.args.fillId as bigint;
  const originHash = `0x${trace.toString(16).padStart(64, "0")}` as Hex;
  log(`  loop trace ${originHash}, fill #${fillId}, reimbursed ${fmtUsd(rb.args.amount as bigint)} mUSD at Unichain block ${rb.blockNumber}`);

  // ----- origin and payout on Base ------------------------------------------------------------------------------
  const originRc = await retry(() => base.pub.getTransactionReceipt({ hash: originHash }));
  const originTx = await retry(() => base.pub.getTransaction({ hash: originHash }));
  if (decodeFunctionData({ abi: ABI.vault, data: originTx.input }).functionName !== "requestWithdraw") {
    throw new Error("the loop's origin transaction is not a requestWithdraw");
  }
  const originTs = (await retry(() => blockTime(base, originRc.blockNumber)))!;
  const settled = (
    (await retry(() =>
      base.pub.getContractEvents({ address: ADDR.vault, abi: ABI.vault, eventName: "WithdrawSettled", fromBlock: originRc.blockNumber, toBlock: originRc.blockNumber + 60n } as never),
    )) as any[]
  ).find((l) => l.args.traceId === trace);
  if (!settled) throw new Error("no WithdrawSettled for this loop");

  // ----- Lasna: every reaction to this trace --------------------------------------------------------------------
  const lo = await blockAtOrBefore(rnk, originTs - 15);
  const handled = (
    (await retry(() =>
      rnk.pub.getContractEvents({ address: ADDR.reactive, abi: ABI.reactive, eventName: "Handled", args: { traceId: trace }, fromBlock: lo, toBlock: lo + 120n } as never),
    )) as any[]
  ).sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
  const handledKind = (k: number) => handled.find((h) => Number(h.args.kind) === k);
  const hState = handledKind(1);
  const hFronted = handledKind(4);
  const hReimbursed = handledKind(5);
  if (!hState || !hFronted || !hReimbursed) throw new Error("missing a Lasna reaction (state / fronted / reimbursed) for this loop");

  const fill = (await retry(() => rnk.pub.readContract({ address: ADDR.reactive, abi: ABI.reactive, functionName: "fills", args: [fillId] } as never))) as readonly unknown[];
  const fillStage = STAGES[Number(fill[2])];

  const paid = settled.args.paid as bigint;
  const requestId = Number(settled.args.requestId);
  const steps: Step[] = [
    await step("origin", "User asks to withdraw", base, originHash, originRc.blockNumber, "ok", `requestWithdraw(${fmtUsd(paid)} mUSD): request #${requestId}, queued with a shortfall because Morpho had no free cash`),
    await step("react", "Omni reacts to the queue", rnk, hState.transactionHash, hState.blockNumber, "ok", "SluiceReactive sees the shortfall and asks the relayer reserve to front it"),
    await step("pay", "User is paid on Base", base, settled.transactionHash, settled.blockNumber, "ok", `the reserve fronts ${fmtUsd(paid)} mUSD and the vault pays request #${requestId} in full (${fmtUsd(settled.args.remaining as bigint)} left owed)`),
    await step("fronted", "Omni sees the payout", rnk, hFronted.transactionHash, hFronted.blockNumber, "ok", "SluiceReactive sees Fronted and asks Unichain to reimburse exactly what was sent"),
    await step("reimburse", "Relayer is reimbursed on Unichain", uni, rb.transactionHash, rb.blockNumber, "ok", `SiblingVault reimburses ${fmtUsd(rb.args.amount as bigint)} mUSD; ${fmtUsd(rb.args.creditAvailable as bigint)} credit left`),
    await step("closed", "Omni closes the fill", rnk, hReimbursed.transactionHash, hReimbursed.blockNumber, "ok", `fill #${fillId} ends in stage ${fillStage}`),
  ];
  if (dp) steps.push(await step("restore1", "Harness cleanup, step 1", uni, dp.transactionHash, dp.blockNumber, "ok", "puts the reimbursed amount back into the sibling vault"));
  steps.push(await step("restore2", "Harness cleanup, step 2", uni, failHash, failRc.blockNumber, "failed", `${call} ran out of gas`));

  // ----- the fix, checked against the source, and the rerun ----------------------------------------------------
  const utilSrc = readFileSync(resolve(ROOT, "harness", "src", "util.ts"), "utf8");
  if (!utilSrc.includes("130n")) throw new Error("harness/src/util.ts no longer carries the 30% gas buffer this write-up describes");

  const rerunRun = runs[runs.indexOf(failedRun) + 1];
  const rerun = rerunRun
    ? {
        file: rerunRun.file,
        loops: rerunRun.rows.length,
        succeeded: rerunRun.rows.filter((r) => r.ok).length,
        examples: rerunRun.rows
          .filter((r) => r.ok)
          .map((r) => ({ loop: r.i as number, links: r.links as Record<string, string>, userPaidMs: r.wallMs.userPaid as number, relayerReimbursedMs: r.wallMs.relayerReimbursed as number })),
      }
    : { file: "", loops: 0, succeeded: 0, examples: [] };

  const recorded = all.filter((r) => r.ok).length;
  const study = {
    generatedAt: new Date().toISOString(),
    counts: { attempted: all.length, recorded, completedOnChain: recorded + failed.length },
    outcome: { userPaid: paid.toString(), relayerReimbursed: (rb.args.amount as bigint).toString(), fillStage, requestId },
    steps,
    failure: {
      tx: failHash,
      link: txUrl(uni, failHash),
      chain: "uni" as const,
      contract: ADDR.sibling,
      call,
      gasLimit: Number(failTx.gas),
      gasUsed: Number(failRc.gasUsed),
      status: "reverted: out of gas",
      block: failRc.blockNumber.toString(),
      cause:
        "The gas estimate for the call came up just short on Unichain Sepolia. The transaction was sent with a gas limit of " +
        `${Number(failTx.gas).toLocaleString("en-US")} and used every unit of it.`,
    },
    fix: {
      description: "Every harness transaction now carries a 30% gas buffer over the node's estimate, so a short estimate cannot end a loop.",
      file: "harness/src/util.ts",
    },
    rerun,
  };
  writeFileSync(resolve(RESULTS, "case-study-flowC.json"), JSON.stringify(study, null, 2));
  log(`\nwrote results/case-study-flowC.json: ${steps.length} steps, ${study.counts.completedOnChain}/${study.counts.attempted} loops completed on-chain, ${recorded} measured`);
  log(`  fill #${fillId} stage ${fillStage}; paid ${fmtUsd(paid)} mUSD; relayer reimbursed ${fmtUsd(rb.args.amount as bigint)} mUSD`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
