import { formatEther } from "viem";
import { base, rnk, uni } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import * as act from "./actions.js";
import { fmtUsd, read } from "./util.js";

async function main() {
  const [m, p, s, inv, cr, h, d] = await Promise.all([
    act.market(),
    act.pending(),
    act.shortfall(),
    act.inventory(),
    act.credit(),
    act.halted(),
    act.delayBlocks(),
  ]);
  const [ethBase, ethUni, react] = await Promise.all([
    base.pub.getBalance({ address: act.me }),
    uni.pub.getBalance({ address: act.me }),
    rnk.pub.getBalance({ address: act.me }),
  ]);
  const [vaultPay, reservePay, siblingPay, rcPay, rcBal] = await Promise.all([
    act.payerState(base, ADDR.vault, ADDR.baseProxy),
    act.payerState(base, ADDR.reserve, ADDR.baseProxy),
    act.payerState(uni, ADDR.sibling, ADDR.uniProxy),
    act.payerState(rnk, ADDR.reactive, ADDR.system),
    rnk.pub.getBalance({ address: ADDR.reactive }),
  ]);
  const rc = await Promise.all(
    ["pending", "shortfall", "inventory", "credit", "pullPending", "pullScheduled", "cron1On", "cron10On", "fillNonce"].map(
      (fn) => read<unknown>(rnk, ADDR.reactive, ABI.reactive, fn),
    ),
  );
  const openFills = await read<bigint[]>(rnk, ADDR.reactive, ABI.reactive, "openFills");
  const util = m.totalSupplyAssets === 0n ? 0 : Number((m.totalBorrowAssets * 10_000n) / m.totalSupplyAssets) / 100;

  const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(`\nSluice status   (wallet ${act.me})\n`);
  console.log("Market and queue (Base Sepolia)");
  line("Morpho supply / borrow", `${fmtUsd(m.totalSupplyAssets)} / ${fmtUsd(m.totalBorrowAssets)} mUSD (${util}% utilized)`);
  line("Vault queue pending / shortfall", `${fmtUsd(p)} / ${fmtUsd(s)} mUSD`);
  line("Relayer reserve inventory", `${fmtUsd(inv)} mUSD`);
  console.log("Cross-chain (Unichain Sepolia)");
  line("Sibling credit available", `${fmtUsd(cr)} mUSD`);
  console.log("Reactive contract (Lasna)");
  line("halted / delayBlocks", `${h} / ${d}`);
  line("caches pending/shortfall/inv/credit", rc.slice(0, 4).map((v) => fmtUsd(v as bigint)).join(" / "));
  line("pullPending / pullScheduled", `${rc[4]} / ${rc[5]}`);
  line("Cron1 / Cron10 subscribed", `${rc[6]} / ${rc[7]}`);
  line("fills opened / open now", `${rc[8]} / ${openFills.length}`);
  console.log("Funding (anything in debt stops working)");
  line("SluiceReactive lREACT balance", formatEther(rcBal));
  line("SluiceReactive system reserves/debt", `${formatEther(rcPay.reserves)} / ${formatEther(rcPay.debt)}`);
  line("SluiceVault proxy reserves/debt", `${formatEther(vaultPay.reserves)} / ${formatEther(vaultPay.debt)} ETH`);
  line("RelayerReserve proxy reserves/debt", `${formatEther(reservePay.reserves)} / ${formatEther(reservePay.debt)} ETH`);
  line("SiblingVault proxy reserves/debt", `${formatEther(siblingPay.reserves)} / ${formatEther(siblingPay.debt)} ETH`);
  console.log("Wallet");
  line("Base Sepolia / Unichain Sepolia ETH", `${formatEther(ethBase)} / ${formatEther(ethUni)}`);
  line("Lasna lREACT", formatEther(react));
  const inDebt = [rcPay, vaultPay, reservePay, siblingPay].some((x) => x.debt > 0n);
  console.log(inDebt ? "\n!! Something is in debt: top it up with depositTo before running loops.\n" : "\nNo debt.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
