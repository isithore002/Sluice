/**
 * Arms the demo for outsiders: leaves withdrawals queued in the vault, so that anyone who repays on behalf of the
 * borrower in our Morpho market (the dashboard's "Try it" panel, or "Try it yourself" in the README)
 * triggers a real settlement. Each repayment of X settles one queued withdrawal, first come first served, so
 * `--slots N` keeps the demo usable for N visitors before it needs re-arming.
 * Usage: npm run arm -- --x 10 --slots 10
 */
import { ABI, ADDR } from "./contracts.js";
import { ensureAllowance, ensureBalance, ensureGas, actors } from "./actors.js";
import * as act from "./actions.js";
import { flag } from "./env.js";
import { send, sleep, usdUnits, fmtUsd } from "./util.js";

const X = usdUnits(Number(flag("x", "10")));
const SLOTS = Math.max(1, Number(flag("slots", "1")));
const log = (s: string) => console.log(s);

async function main() {
  const { alice } = actors();
  const total = X * BigInt(SLOTS);
  await act.setMode({ crossChain: false, delay: 0n }, log);
  await ensureGas(alice.address, log);
  await act.normalize(log); // nobody queued, market at 100% utilization
  await ensureBalance(alice, total);
  await ensureAllowance(alice, ADDR.vault, total * 1000n);
  await send(alice, ADDR.vault, ABI.vault, "deposit", [total]);
  await act.normalize(log); // the borrower takes the liquidity Alice's deposit created

  for (let i = 0; i < SLOTS; i++) {
    // A public RPC can time out on a transaction that was in fact mined: check the queue before every retry.
    for (let attempt = 0; ; attempt++) {
      if ((await act.pending()) >= X * BigInt(i + 1)) break;
      try {
        await send(alice, ADDR.vault, ABI.vault, "requestWithdraw", [X]);
      } catch (e) {
        if (attempt >= 3) throw e;
        log(`  request ${i + 1} failed (${String(e).split("\n")[0].slice(0, 100)}); checking the queue, then retrying`);
        await sleep(4_000);
      }
    }
  }

  const pending = await act.pending();
  log(
    `Armed: ${fmtUsd(pending)} mUSD queued for ${alice.address} as ${SLOTS} withdrawal(s) of ${fmtUsd(X)} (market ${
      (await act.liquidity()) === 0n ? "fully borrowed" : "has free liquidity!"
    }).`,
  );
  log(`Each repayment of ${fmtUsd(X)} mUSD on behalf of the borrower ${act.me} in Morpho settles one of them.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
