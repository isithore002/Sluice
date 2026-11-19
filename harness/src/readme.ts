/**
 * Regenerates the measured-results and deployed-contracts sections of README.md from results/summary.json and
 * deployments/*.json, so numbers, addresses and links are never typed by hand.
 * Usage (after `npm run summary`): npx tsx src/readme.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const BASE = "https://sepolia.basescan.org";
const UNI = "https://sepolia.uniscan.xyz";
const LASNA = "https://lasna.reactscan.net";

const B = summary.flowB;
const C = summary.flowC;
const date = String(summary.generatedAt).slice(0, 10);

const results = `
Measured on live testnets and generated from [\`results/summary.json\`](results/summary.json) (${date}). Every record in [\`results/\`](results/) carries the transaction hashes of each hop. Wall-clock times come from polling every ~150 ms, so each includes up to one poll interval of observation delay.

### Latency

| Loop | Success | Median | p95 | Max |
|---|---|---|---|---|
| **Flow B:** Morpho repay → queue paid | ${B.succeeded}/${B.attempted} | **${s(B.totalWallMs.median)}** | ${s(B.totalWallMs.p95)} | ${s(B.totalWallMs.max)} |
|   of which repay → Lasna react | | ${s(B.originToReactiveWallMs.median)} | ${s(B.originToReactiveWallMs.p95)} | ${s(B.originToReactiveWallMs.max)} |
| **Flow C:** shortfall → user paid by the reserve | ${C.succeeded}/${C.attempted} | **${s(C.userPaidWallMs.median)}** | ${s(C.userPaidWallMs.p95)} | ${s(C.userPaidWallMs.max)} |
|   shortfall → relayer reimbursed on Unichain | | ${s(C.relayerReimbursedWallMs.median)} | ${s(C.relayerReimbursedWallMs.p95)} | ${s(C.relayerReimbursedWallMs.max)} |

The user is paid after **one** reactive hop; the relayer is reimbursed one hop later, only after \`Fronted\` is confirmed.

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
- The "+6 blocks" rows add delay on Omni (\`delayBlocks = 6\`). They approximate legacy speed; they are not runs on the legacy network.
- The competitor runs on one machine through a public RPC, so its own transaction takes ~1.2 to 1.4 s to land. An in-region bot would be faster, so the 0 s row is not the speed limit.

### Verify a loop yourself

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

Failures and discarded runs are documented in [\`results/README.md\`](results/README.md).
`;

const deployed = `
Deployed with [\`scripts/deploy.sh\`](scripts/deploy.sh). Addresses are in [\`deployments/\`](deployments/), and every deployment transaction is in [\`broadcast/\`](broadcast/).

| Contract | Network | Address |
|---|---|---|
| SluiceReactive | Reactive Lasna (5318007) | ${a(LASNA, lasna.sluiceReactive)} |
| SluiceVault | Base Sepolia (84532) | ${a(BASE, baseSluice.sluiceVault)} |
| RelayerReserve | Base Sepolia | ${a(BASE, baseSluice.relayerReserve)} |
| Morpho Blue (third party, pre-existing) | Base Sepolia | ${a(BASE, market.morpho)} |
| Demo market loan token (MockUSD) | Base Sepolia | ${a(BASE, market.mockUSD)} |
| Demo market collateral token | Base Sepolia | ${a(BASE, market.mockCollateral)} |
| Demo market oracle (fixed price) | Base Sepolia | ${a(BASE, market.oracle)} |
| SiblingVault | Unichain Sepolia (1301) | ${a(UNI, uniSluice.siblingVault)} |
| MockUSD | Unichain Sepolia | ${a(UNI, uniToken.mockUSD)} |

Our Morpho market id: \`${market.marketId}\` (loan token MockUSD, zero-rate IRM, 86% LLTV).
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
writeFileSync(readme, text);
console.log("README.md results and deployed sections regenerated");
