/**
 * Puts the system in the start state for the live Lender/Borrower demo on the dashboard: cross-chain fronting halted
 * (so the Morpho path is the one that pays), nobody in the queue, and the Morpho market 100% borrowed by our demo
 * borrower. From there a visitor's lender deposits, a visitor's borrower borrows that cash, the lender's withdrawal
 * queues as ticket #1, and the borrower's repayment on Morpho makes Reactive pay it.
 * Safe to rerun: it sends transactions only for what is out of place. Note it pays out any armed Quick-repay tickets
 * (see arm.ts), because a deposit pays earlier tickets first.
 * Usage: npm run stage
 */
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { base } from "./chains.js";
import { read, fmtUsd } from "./util.js";

const log = (s: string) => console.log(s);

async function main() {
  await act.setMode({ crossChain: false, delay: 0n }, log);
  await act.normalize(log);

  const [len, head, pending, m, halted, delay] = await Promise.all([
    read<bigint>(base, ADDR.vault, ABI.vault, "queueLength"),
    read<bigint>(base, ADDR.vault, ABI.vault, "head"),
    act.pending(),
    act.market(),
    act.halted(),
    act.delayBlocks(),
  ]);
  const queued = len - head;
  const util = m.totalSupplyAssets > 0n ? Number((m.totalBorrowAssets * 10000n) / m.totalSupplyAssets) / 100 : 0;
  log("Staged for the live demo:");
  log(`  queue          ${queued} waiting, ${fmtUsd(pending)} mUSD pending`);
  log(`  Morpho market  supplied ${fmtUsd(m.totalSupplyAssets)} / borrowed ${fmtUsd(m.totalBorrowAssets)} mUSD (${util}% utilized)`);
  log(`  Reactive       cross-chain fronting ${halted ? "halted" : "ON"}, delayBlocks ${delay}`);
  if (queued !== 0n || halted !== true || delay !== 0n || util < 100) {
    console.error("NOT in the start state: rerun, and check the lines above.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
