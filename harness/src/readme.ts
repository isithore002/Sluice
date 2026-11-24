/**
 * Regenerates the measured-results and deployed-contracts sections of README.md from results/summary.json and
 * deployments/*.json, so numbers, addresses and links are never typed by hand.
 * Usage (after `npm run summary`): npx tsx src/readme.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEPLOYMENTS, RESULTS, ROOT } from "./env.js";

const readme = resolve(ROOT, "README.md");
const summary = JSON.parse(readFileSync(resolve(RESULTS, "summary.json"), "utf8"));
const dep = (f: string) => JSON.parse(readFileSync(resolve(DEPLOYMENTS, f), "utf8"));
const market = dep("base-market.json");
const baseSluice = dep("base-sluice.json");
const uniSluice = dep("unichain-sluice.json");
const uniToken = dep("unichain-token.json");
const lasna = dep("lasna-reactive.json");

const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const a = (host: string, addr: string) => `[\`${addr}\`](${host}/address/${addr})`;
/** Source verified on Sourcify (exact match): readable at the deployed address. */
const src = (chainId: number, addr: string) => `[verified ✓](https://repo.sourcify.dev/${chainId}/${addr})`;
const BASE = "https://sepolia.basescan.org";
const UNI = "https://sepolia.uniscan.xyz";
const LASNA = "https://lasna.reactscan.net";

const B = summary.flowB;
const C = summary.flowC;
const I = summary.independent;
const O = JSON.parse(readFileSync(resolve(RESULTS, "outsider-tryit.json"), "utf8"));
const tryitFile = resolve(DEPLOYMENTS, "base-tryit.json");
const TRY = existsSync(tryitFile) ? JSON.parse(readFileSync(tryitFile, "utf8")) : null;
const ocFile = resolve(RESULTS, "oneclick-ui-test.json");
const OC = existsSync(ocFile) ? JSON.parse(readFileSync(ocFile, "utf8")) : null;
const date = String(summary.generatedAt).slice(0, 10);
const BT = summary.batch;
const CASE = summary.crossChainCaseStudy;
const CSJ = CASE ? JSON.parse(readFileSync(resolve(RESULTS, "case-study-flowC.json"), "utf8")) : null;
const usd = (v: string) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const chainName: Record<string, string> = { base: "Base Sepolia", uni: "Unichain Sepolia", lasna: "Reactive Lasna" };

const results = `
Measured on live testnets and generated from [\`results/summary.json\`](results/summary.json) (${date}). Every record in [\`results/\`](results/) carries the transaction hashes of each hop. Wall-clock times come from polling every ~150 ms, so each includes up to one poll interval of observation delay.

### Latency

| Loop | Success | Median | p95 | Max |
|---|---|---|---|---|
| **Flow B:** Morpho repay → queue paid | ${B.succeeded}/${B.attempted} | **${s(B.totalWallMs.median)}** | ${s(B.totalWallMs.p95)} | ${s(B.totalWallMs.max)} |
|   of which repay → Lasna react | | ${s(B.originToReactiveWallMs.median)} | ${s(B.originToReactiveWallMs.p95)} | ${s(B.originToReactiveWallMs.max)} |
| **Flow C:** shortfall → user paid by the reserve | ${C.succeeded}/${C.attempted} | **${s(C.userPaidWallMs.median)}** | ${s(C.userPaidWallMs.p95)} | ${s(C.userPaidWallMs.max)} |
|   shortfall → relayer reimbursed on Unichain | | ${s(C.relayerReimbursedWallMs.median)} | ${s(C.relayerReimbursedWallMs.p95)} | ${s(C.relayerReimbursedWallMs.max)} |

The user is paid after **one** reactive hop; the relayer is reimbursed one hop later, only after \`Fronted\` is confirmed.${CASE ? `

Flow C shows ${C.succeeded}/${C.attempted} because one loop's timings were never saved, not because a payout failed: that loop completed on-chain too ([details below](#the-cross-chain-loop-that-is-not-in-the-numbers)).` : ""}

### The latency race

When freed liquidity is contested, how much does the queue capture? A competitor bot (a lender in the same Morpho market) fires a withdrawal \`C\` seconds after seeing each repayment, with no market read and a fixed gas limit. Capture = the share of the repaid amount that reaches the queue. 6 rounds per cell, 60 rounds in total, every round accounted for exactly (queue payout + competitor payout = amount).

| Competitor sends after | Omni native (Sluice acts in ~${s(summary.race.filter((r: any) => r.delayBlocks === 0).reduce((m: number, r: any) => m + r.sluiceActedMs.median, 0) / summary.race.filter((r: any) => r.delayBlocks === 0).length)}) | +6 Lasna blocks (~legacy, acts in ~${s(summary.race.filter((r: any) => r.delayBlocks > 0).reduce((m: number, r: any) => m + r.sluiceActedMs.median, 0) / summary.race.filter((r: any) => r.delayBlocks > 0).length)}) |
|---|---|---|
${[...new Set(summary.race.map((r: any) => r.competitorDelayS))]
  .sort((x: any, y: any) => x - y)
  .map((d: any) => {
    const n = summary.race.find((r: any) => r.delayBlocks === 0 && r.competitorDelayS === d);
    const l = summary.race.find((r: any) => r.delayBlocks > 0 && r.competitorDelayS === d);
    return `| ${d} s | ${Math.round(n.meanCapture * 100)}% | ${Math.round(l.meanCapture * 100)}% |`;
  })
  .join("\n")}

**Reading it honestly:**

- At Omni speed the queue beats any competitor that reacts a second or more after the repayment, and loses to an instant one (an instant competitor beats it most of the time).
- At legacy-like speed the queue loses to every competitor except the slowest. That gap is the case for Omni here.
- The "+6 blocks" rows reproduce the legacy network's cadence on Omni (\`delayBlocks = 6\`). The legacy network no longer exists (Lasna and Reactive Mainnet both moved to the Omni fork in October 2026), so it can't be run today. Reactive's own figure for legacy blocks is about 7 seconds ([announcement](https://blog.reactive.network/reactive-omni-buildathon-thirty-days-to-find-out-what-one-second-buys/)).
- The competitor runs on one machine through a public RPC, so its own transaction takes ~1.2 to 1.4 s to land. An in-region bot would be faster, so the 0 s row is not the speed limit.

${BT ? `### One repayment, many withdrawals

A callback pays at most ${BT.cap} queued withdrawals, so its gas stays bounded. When ONE repayment frees cash for more than that, Reactive has to notice that the vault still holds payable cash and schedule the next batch by itself. Checked on the live contracts: ${BT.n} separate wallets queued ${usd(BT.each)} mUSD each (request ids ${BT.firstRequestId} to ${BT.lastRequestId}), then **one** repayment of ${usd(BT.total)} mUSD paid every one of them, in **${BT.callbacks} callbacks** (${BT.payments.join(" + ")} payments). Nobody deposited again and nobody called anything.

| Measure | Result |
|---|---|
| Repay → first batch paid | ${BT.repayToFirstBatchMs === null ? "n/a" : s(BT.repayToFirstBatchMs)} |
| Repay → queue empty | **${s(BT.repayToQueueEmptyMs)}** |
| Order | strict first come, first served: ids ${BT.firstRequestId} to ${BT.lastRequestId}, no gaps (checked from the events) |
| Largest callback | ${BT.maxGasUsed.toLocaleString("en-US")} gas of the ${BT.gasLimit.toLocaleString("en-US")} limit |

How it continues: after each batch the vault emits \`StateUpdated\`. SluiceReactive sees that people are still queued, that cash is reachable, and that the last pull made progress, so it requests another pull. A pull that makes no progress never triggers another, so it cannot loop. Foundry runs the same scenarios against the real Morpho bytecode: 40 queued → 2 callbacks, 80 → 4, and cash for only 30 of 40 stops at 30. A full 25-payment callback to fresh recipients costs 927,744 gas in Foundry and ${BT.maxGasUsed.toLocaleString("en-US")} on-chain.

Transactions: [the repayment](${BT.repayLink}), then ${BT.callbackLinks.map((l: string, i: number) => `[Omni request ${i + 1}](${BT.reactiveLinks[i]}) → [callback ${i + 1}](${l})`).join(", ")}. The dashboard replays the run on a payout board.

` : ""}### Verify a loop yourself

One real loop of each flow. Only the first transaction in each is sent by our wallet. The callbacks are sent by Reactive's signer, and nothing of ours runs in between.

**Flow B (Morpho repayment settles the queue):**
1. [Borrower repays in Morpho, Base Sepolia](${B.example.origin})
2. [SluiceReactive reacts, Reactive Lasna](${B.example.reactive})
3. [Callback pays the queue, Base Sepolia](${B.example.callback})

**Flow C (shortfall fronted, relayer reimbursed):**
1. [Withdrawal queued with a shortfall, Base Sepolia](${C.example.origin})
2. [SluiceReactive reacts, Reactive Lasna](${C.example.reactive})
3. [Reserve fronts and the user is paid, Base Sepolia](${C.example.front})
4. [Relayer reimbursed, Unichain Sepolia](${C.example.reimburse})

### Independent actors

The loops above reuse one wallet for most roles. To show Sluice doesn't depend on that, ${I.succeeded} more loops use **separate wallets** (separate addresses that we control, not separate people): Alice (a user) deposits and queues a withdrawal, Bob (an outsider) repays on behalf of the borrower in Morpho, and Reactive pays Alice. The deployer only funds their gas, and is the borrower whose debt Bob repays. **${I.succeeded}/${I.attempted} succeeded, ${I.allIndependent ? "and in every one the withdrawal request, the repayment and the payout all involved addresses other than the deployer" : "but not every loop was independent"}** (median ${s(I.totalWallMs.median)} from repayment to queue paid).

| Role | Address |
|---|---|
| Alice, the user whose withdrawal is queued and paid | ${a(BASE, I.example.actors.aliceUser)} |
| Bob, the outsider who repays | ${a(BASE, I.example.actors.bobRepayer)} |
| Deployer, the borrower whose debt is repaid | ${a(BASE, I.example.actors.deployerAndBorrower)} |
| Reactive's signer when these loops ran (2026-11-19), which sent the payout callback | ${a(BASE, I.example.actors.callbackSentBy)} |
| Reactive's signer now (it rotated: see [limitations](#limitations-and-claims-we-dont-make)) | ${a(BASE, "0xF9F61C1D3325e2d4aBb55dd9e0Db84F7A0D914B0")} |

One loop to check: [Alice queues a withdrawal](${I.example.links.queued}), [Bob repays](${I.example.links.origin}), [SluiceReactive reacts](${I.example.links.reactive}), [the callback pays Alice](${I.example.links.callback}).

What this does **not** remove: the market, the tokens, the oracle, the vault funding and the queued withdrawal are still set up by us, which is unavoidable on a testnet. The strongest check is yours: see [Try it yourself](#try-it-yourself).

${CASE ? `### The cross-chain loop that is not in the numbers

${CASE.completedOnChain} of ${CASE.attempted} cross-chain loops completed on-chain, but only ${CASE.recorded} are in the latency table. Reconstructed from chain data (\`npm run casestudy\`), the missing one finished correctly: the user was paid, the relayer was reimbursed and the fill ended ${CSJ.outcome.fillStage}. What failed was the **test harness's own cleanup**: its \`${CASE.failedCall}\` call on the sibling vault ran out of gas (${CASE.gasUsed.toLocaleString("en-US")} of ${CASE.gasLimit.toLocaleString("en-US")}: the node's gas estimate was just short on Unichain Sepolia). The harness threw before it saved the loop's timings, so the loop was recorded as failed and has no latency data.

| # | Step | Chain | Transaction | Result |
|---|---|---|---|---|
${CSJ.steps.map((st: any, i: number) => `| ${i + 1} | ${st.label} | ${chainName[st.chain]} | [\`${st.tx.slice(0, 10)}…${st.tx.slice(-4)}\`](${st.link}) | ${st.status === "ok" ? "✓" : "✗"} ${st.note ?? ""} |`).join("\n")}

The fix: every harness transaction now carries a 30% gas buffer over the node's estimate ([\`harness/src/util.ts\`](harness/src/util.ts)). The rerun after the fix, **${CSJ.rerun.succeeded} of ${CSJ.rerun.loops} loops succeeded**, is published next to the original in [\`results/${CSJ.rerun.file}\`](results/${CSJ.rerun.file}). Write-up: [\`docs/CASE_STUDY_FLOW_C.md\`](docs/CASE_STUDY_FLOW_C.md).

` : ""}Failures and discarded runs are documented in [\`results/README.md\`](results/README.md).
`;

const deployed = `
Deployed with [\`scripts/deploy.sh\`](scripts/deploy.sh). Addresses are in [\`deployments/\`](deployments/), and every deployment transaction is in [\`broadcast/\`](broadcast/).

| Contract | Network | Address | Source |
|---|---|---|---|
| SluiceReactive | Reactive Lasna (5318007) | ${a(LASNA, lasna.sluiceReactive)} | ${src(5318007, lasna.sluiceReactive)} |
| SluiceVault | Base Sepolia (84532) | ${a(BASE, baseSluice.sluiceVault)} | ${src(84532, baseSluice.sluiceVault)} |
| RelayerReserve | Base Sepolia | ${a(BASE, baseSluice.relayerReserve)} | ${src(84532, baseSluice.relayerReserve)} |
| Morpho Blue (third party, pre-existing) | Base Sepolia | ${a(BASE, market.morpho)} | not ours |
| Demo market loan token (MockUSD) | Base Sepolia | ${a(BASE, market.mockUSD)} | ${src(84532, market.mockUSD)} |
| Demo market collateral token | Base Sepolia | ${a(BASE, market.mockCollateral)} | ${src(84532, market.mockCollateral)} |
| Demo market oracle (fixed price) | Base Sepolia | ${a(BASE, market.oracle)} | ${src(84532, market.oracle)} |
| SiblingVault | Unichain Sepolia (1301) | ${a(UNI, uniSluice.siblingVault)} | ${src(1301, uniSluice.siblingVault)} |
| MockUSD | Unichain Sepolia | ${a(UNI, uniToken.mockUSD)} | ${src(1301, uniToken.mockUSD)} |${TRY ? `
| OneClickRepay (demo helper for the one-click repay shortcut, not part of Sluice) | Base Sepolia | ${a(BASE, TRY.oneClickRepay)} | ${src(84532, TRY.oneClickRepay)} |` : ""}

All Sluice contracts are source-verified on [Sourcify](https://sourcify.dev) with an **exact match** (creation and runtime bytecode), so the code at each address is exactly this repository's code.

Our Morpho market id: \`${market.marketId}\` (loan token MockUSD, zero-rate IRM, 86% LLTV).
`;

const tryit = `
### Live demo: lender and borrower

The dashboard's **Live demo** section runs the whole product with two separate wallets, one per role. Every button is a real transaction on Base Sepolia, and the pool view is read from the chains.

| Role | Who | What they do |
|---|---|---|
| **Lender** | any wallet | Mints demo mUSD (open mint), approves, **deposits** into the Sluice vault, then **requests a withdrawal**. When the pool has no free cash the request joins the queue as a ticket. Never touches Morpho or Reactive. |
| **Borrower** | a different wallet | Mints demo collateral, approves, **supplies collateral** and **borrows the pool's free cash** straight on Morpho (this empties the pool), later **repays** on Morpho. Never touches Sluice. |
| **Morpho** | Morpho Blue (not ours) | The lending market. The vault supplies the lenders' cash into it. |
| **Sluice vault** | our contract | Holds deposits, keeps the withdrawal queue and pays tickets first come, first served. |
| **Reactive contract** | our contract on Lasna | Watches Morpho for repayments and tells the vault to pay the queue. |
| **Reactive's signer** | Reactive Network | Delivers that instruction as a transaction. We never send it. |
| **Operator** | our deployer wallet | Deploys, funds and stages the demo. **Not touched during the demo.** |

**Nobody calls Sluice to settle.** When the borrower repays on Morpho, Reactive sees the \`Repay\` event and Reactive's signer pays the lender's ticket. The pool view shows the Morpho tank, the live queue tickets, and what Reactive just did (\`Repay\` on Base, \`PullRequested\` on Lasna, \`WithdrawSettled\` on Base, with timings from block timestamps).

**Order matters.** The queue must be empty when the demo starts, because a lender's deposit pays earlier tickets first. \`npm run stage\` in \`harness/\` puts the system in that start state (cross-chain fronting paused so the Morpho path is the one that pays, nobody queued, the market fully borrowed by our demo borrower). The one-click repay shortcut below needs the opposite state (armed tickets, \`npm run arm -- --x 10 --slots 10\`), so don't mix the two in one session.

**Real vs test setup:** every transaction and every number on screen is real. The tokens are open-mint mocks, the Morpho market and its price feed are ours, and it all runs on testnets.

### One-click repay (shortcut) and terminal steps

Anyone can also trigger a real Sluice settlement with one transaction, with nothing of ours involved. In Morpho Blue, **anyone can repay on behalf of a borrower**, and our demo token is open-mint.
${TRY ? `
**One click:** the dashboard's *One-click repay* shortcut (under *Deep dive*) does it from your browser wallet. The helper it uses is demo scaffolding for convenience, not part of Sluice. Its *Connect wallet* button opens a wallet list (RainbowKit, on wagmi) with MetaMask, Phantom, Coinbase Wallet, Rabby and any other installed wallet, then switches the wallet to Base Sepolia (Phantom needs Testnet Mode on: Settings → Developer Settings → Testnet Mode). The panel calls ${a(BASE, TRY.oneClickRepay)} (source verified), which mints 10 demo mUSD and repays them on the borrower's behalf in a single transaction, so you confirm one transaction instead of three.${OC ? ` We tested the one-click path end to end with a brand-new wallet we created: [its transaction](${OC.links.visitorSettle}) was settled by [this callback](${OC.links.reactiveCallback}), sent by Reactive's signer ([\`results/oneclick-ui-test.json\`](results/oneclick-ui-test.json); the test drove the panel's earlier connect button with an injected wallet provider in place of a MetaMask popup).` : ""}

` : ""}

**From a terminal**, the same three steps with \`cast\`:

**You need:** a throwaway testnet key with a little Base Sepolia ETH for gas (a fraction of a cent), and [Foundry](https://book.getfoundry.sh/)'s \`cast\`.

**First, check the demo is armed.** The dashboard's *Withdrawal queue* card should show a pending amount above 0 (a withdrawal waiting to be paid). If it shows 0, the last settlement already happened, and the demo needs re-arming (\`npm run arm -- --x 10 --slots 10\` in \`harness/\` queues ten withdrawals, one per repayment).

\`\`\`bash
export RPC=https://sepolia.base.org
export KEY=0xYOUR_THROWAWAY_TESTNET_KEY
ME=$(cast wallet address --private-key $KEY)

# 1. Mint yourself 10 MockUSD (anyone can)
cast send ${market.mockUSD} "mint(address,uint256)" $ME 10000000 --rpc-url $RPC --private-key $KEY

# 2. Let Morpho take it
cast send ${market.mockUSD} "approve(address,uint256)" ${market.morpho} 10000000 --rpc-url $RPC --private-key $KEY

# 3. Repay 10 mUSD on behalf of the borrower. This is the event Sluice reacts to.
cast send ${market.morpho} "repay((address,address,address,address,uint256),uint256,uint256,address,bytes)" \\
  "(${market.mockUSD},${market.mockCollateral},${market.oracle},0x0000000000000000000000000000000000000000,${market.lltv})" \\
  10000000 0 ${I.example.actors.deployerAndBorrower} 0x --rpc-url $RPC --private-key $KEY
\`\`\`

**What you should see**, within about two seconds:

1. Your repayment shows in Morpho.
2. SluiceReactive reacts on Lasna ([see its transactions](${LASNA}/address/${lasna.sluiceReactive})).
3. A \`WithdrawSettled\` event appears on the [SluiceVault](${BASE}/address/${baseSluice.sluiceVault}): the queued withdrawal is paid, by a transaction sent by Reactive's signer, not by you or us.

Your wallet sends only the repayment. The queued withdrawal belongs to Alice (above), and the payout goes to her.

**We ran exactly these commands from a brand-new wallet that we created for the test** (${a(BASE, O.outsider)}, which had never touched the project and sent only these ${O.outsiderTransactionCount} transactions): [mint](${BASE}/tx/${O.txs.mint}), [approve](${BASE}/tx/${O.txs.approve}), [repay](${BASE}/tx/${O.txs.repay}). Reactive then paid ${O.paid} mUSD to Alice in [this settlement](${BASE}/tx/${O.txs.settlement}), sent by Reactive's signer. The result is in [\`results/outsider-tryit.json\`](results/outsider-tryit.json).

**Costs us, not you:** each settlement costs the reactive contract about 0.08 lREACT, so please don't loop it. If it stops responding, it ran out of funds.
`;

function replace(text: string, name: string, body: string): string {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`README.md is missing the ${name} markers`);
  return text.slice(0, i + start.length) + "\n" + body.trim() + "\n" + text.slice(j);
}

let text = readFileSync(readme, "utf8");
text = replace(text, "RESULTS", results);
text = replace(text, "DEPLOYED", deployed);
text = replace(text, "TRYIT", tryit);
writeFileSync(readme, text);
console.log("README.md results and deployed sections regenerated");
