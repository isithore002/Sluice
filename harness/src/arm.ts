/**
 * Arms the demo for outsiders: leaves exactly one withdrawal queued in the vault, so that anyone who repays on
 * behalf of the borrower in our Morpho market (see "Try it yourself" in the README) triggers a real settlement.
 * Re-run after each outsider-triggered settlement. Usage: npm run arm -- --x 10
 */
import { ABI, ADDR } from "./contracts.js";
import { ensureAllowance, ensureBalance, ensureGas, actors } from "./actors.js";
import * as act from "./actions.js";
import { flag } from "./env.js";
import { send, usdUnits, fmtUsd } from "./util.js";

const X = usdUnits(Number(flag("x", "10")));
const log = (s: string) => console.log(s);

async function main() {
  const { alice } = actors();
  await act.setMode({ crossChain: false, delay: 0n }, log);
  await ensureGas(alice.address, log);
  await act.normalize(log);
  await ensureBalance(alice, X);
  await ensureAllowance(alice, ADDR.vault, X * 1000n);
  await send(alice, ADDR.vault, ABI.vault, "deposit", [X]);
  await act.normalize(log); // the borrower takes the liquidity Alice's deposit created
  await send(alice, ADDR.vault, ABI.vault, "requestWithdraw", [X]);
  const pending = await act.pending();
  log(`Armed: ${fmtUsd(pending)} mUSD queued for ${alice.address} (market ${((await act.liquidity()) === 0n) ? "fully borrowed" : "has free liquidity!"}).`);
  log(`Anyone can now repay ${fmtUsd(X)} mUSD on behalf of the borrower ${act.me} in Morpho to settle it.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
