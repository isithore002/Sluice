# Submission material

Everything needed for the DoraHacks submission and the demo video. Numbers and hashes here come from `results/summary.json` as of 2026-11-19. If you rerun measurements, regenerate the README with `npx tsx src/readme.ts` and update the figures below.

**Deadline: Sat Dec 5, 2026, 20:00 UTC.** Aim to submit by Fri Dec 4.

---

## 1. The build card

| Field | Value |
|---|---|
| Name | Sluice |
| Track | **Every Second Counts** |
| One-liner | When liquidity comes back anywhere (a Morpho repayment or spare credit on another chain), a Reactive contract pays the withdrawal queue in order within seconds. No manager, no bot. |
| Repository | https://github.com/isithore002/Sluice (public, MIT) |
| Demo video | *record it (section 3), then paste the link* |
| Live dashboard | *host `dashboard/out` (see BUILD_GUIDE phase E), then paste the link* |
| Suggested tags | Crypto / Web3, DeFi, Infra / API, Cross-chain, Base, Unichain, Reactive Network |

### Short description (for the build page)

Sluice makes withdrawal queues settle themselves. When a lending vault runs out of free cash, withdrawals queue up, and today a manager or bot decides when to pay them while the fastest bot grabs freed liquidity first. Sluice replaces that operator with a Reactive contract that watches a Morpho Blue market (a repayment) and a sibling vault on another chain (spare credit), and pays the queue first come, first served. A repayment pays the queue in a median **1.58 s**. A shortfall on Base is covered by a relayer reserve in **1.36 s**, and the relayer is reimbursed on Unichain only after the front is confirmed, for exactly what was sent. A measured latency race shows why Omni matters: against competitors that reach for freed liquidity a few seconds after a repayment, the queue captures it at Omni speed and loses it at legacy-like speed.

---

## 2. Form answers

**Deployed contract addresses, and which network (Reactive mainnet or Lasna)?**

Reactive **Lasna** testnet (5318007), with callbacks to Base Sepolia (84532) and Unichain Sepolia (1301). All Sluice contracts are source-verified on Sourcify (exact match).

- SluiceReactive (Lasna): `0xD49236Bb296e8935dC302De0cccFDf5EC5413157`
- SluiceVault (Base Sepolia): `0x3d65a5E73d43B5D20Afe7484eecC5D1364e3dEd6`
- RelayerReserve (Base Sepolia): `0x48cbca9BAad89fACBEc9AcC083782B6fE10C04de`
- SiblingVault (Unichain Sepolia): `0x2CD91D217610083aBfF78b6609c79193E619b5d7`
- Morpho Blue (third party, pre-existing, Base Sepolia): `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
- Our Morpho market id: `0xfa6e6efff85e0699003a9a81cb4b3a8113b520799e8bcb81a68a2d5e85ea4980`
- Demo tokens: MockUSD `0x586c3d4bee371Df96063F045Aee49081Bc2e7cf7` (Base), `0xdAFaC2C362d3D811124be77B0ABF84e677091750` (Unichain); collateral `0xB5b2E077521E43647cc75BF10e5285F036C22DBb`; oracle `0x26f814373D575bDC074175A686c3Ff197D4e3b07`

**Transaction hashes showing the full loop, from origin event to callback.**

Flow B, a Morpho repayment settles the withdrawal queue:
- Origin, borrower repays in Morpho (Base Sepolia): `0x3b8552c579a76f54fbb3d982478a2420ab18b3bd7429a9f1be5c8952570bc6d5`
- Reactive transaction (Lasna): `0xbc8931dc34f64aa89ede11c0310a298c1e382fa506970beea5637939c3d5fffb`
- Callback pays the queue (Base Sepolia): `0x676ae7d7ccbf0b0146c12091fa8a3915d21be3853c4c853eec6118076bbbca30`

Flow C, a shortfall is fronted and the relayer reimbursed across chains:
- Origin, withdrawal queued with a shortfall (Base Sepolia): `0xe074b45195f9d15e6af2390a31922406655170f89bb3c06dc8492b1673cb45f9`
- Reactive transaction (Lasna): `0x462e19cad21afe52d440c962843d1e9936d93ac7b8e3149d5abe748284cb8f60`
- Callback, reserve fronts and the user is paid (Base Sepolia): `0x6d643b9485732145190ce578ad7d52302bab406a6304bf29e50d50c79684066a`
- Callback, relayer reimbursed (Unichain Sepolia): `0x1db0937b563d71a8eff8efddaf469f8033d3747364af65ae9739931f7d2f7c93`

Only the origin transaction in each loop is sent by our wallet. The callbacks are sent by Reactive's signer (`0xF7E866D726658F6C3F14B8EE537fe268a4D91DDb`). Explorer links for these are in the README, and every loop's hashes are in `results/`.

**For Every Second Counts: what full-loop latency did you measure, and how?**

Each loop is traced end to end by the origin transaction's hash, which every callback carries and every event emits. A TypeScript harness (viem) records wall-clock milliseconds, polling every ~150 ms, and block timestamps, which only resolve to 1 s.

- **Flow B** (repayment → queue paid), 33/33 loops: median **1.58 s**, p95 2.10 s, max 2.20 s. Of that, repayment → Lasna react is 1.17 s.
- **Flow C** (shortfall → user paid by the reserve), 31/32 loops: median **1.36 s**, p95 2.16 s. The relayer is reimbursed on Unichain at a median 4.60 s.
- **The latency race** (60 rounds, every round accounted for exactly): when freed liquidity is contested by a competitor bot that fires a withdrawal after a delay, Sluice at Omni speed (acts in ~1.4 s) captures 100% of it against a 1 s competitor, 100% against 4 s, and 17% against an instant one. The same system slowed to legacy-like speed (acts in ~7.6 s, by adding 6 Lasna blocks of delay) captures 0% against 1 s, 0% against 4 s, and only wins against the 8 s competitor (100%). The legacy-like rows add delay on Omni; they are not runs on the legacy network. An instant competitor beats Sluice at either speed.

**Was this your first time building with Reactive? Your first smart contract?**

First time with Reactive, yes. Not my first smart contract.

**What was the hardest part of building with Reactive?**

*Edit to taste. These are the real obstacles, in order of how much time they cost:*

1. **Getting the failure semantics right.** A contract in debt silently stops receiving events or callbacks, and callbacks are billed to the *recipient on the destination chain in that chain's ETH*, not to the reactive contract in lREACT. I designed every cached value to be overwritten by absolute-valued events, and made the destination functions idempotent and able to re-emit their result, so a missed event heals on retry. Testing this found a real bug: if both events of one execution were missed, a retry could front the same shortfall twice. The fix was making the reserve always publish fresh vault state *before* confirming.
2. **Immutable callback sender and deployment order.** Each callback contract stores its reactive contract's address permanently, so the reactive contract must be deployed first and any redeploy forces redeploying every callback contract.
3. **Lasna rejects zero priority fees.** Standard tooling estimates a zero tip, so transactions failed with "gas tip cap 0, minimum needed 1" until it was set explicitly.
4. **Budgeting lREACT.** About 0.02 lREACT per reactive transaction adds up quickly across hundreds of measurement loops; Cron ticks are billed even when nothing happens, so the design subscribes to Cron only while something is in flight.
5. **Tooling for Omni.** The test library's `omni` branch and the pinned library versions were essential, and the demos repository's `omni` branch no longer has the old basic demo.

**How did you hear about the buildathon?**

*fill in*

---

## 3. Demo video script (under 3:00)

**Before recording:**
- [ ] Run `npm run status` in `harness/`: no debt, lREACT balance healthy. A live loop costs about 0.1 lREACT, so keep at least 1.5 for retakes (top up with `depositTo`, see BUILD_GUIDE step 14).
- [ ] Dashboard open in one window (hosted URL or `dashboard/out`), explorer tabs ready.
- [ ] Terminal in `harness/`, big font.
- [ ] Do a dry run with `npx tsx src/flowB.ts --n 2 --x 10`.
- [ ] Don't show your `.env` file or any key.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:20 | The README problem section | "When a lending market runs out of cash, depositors can't withdraw. They join a queue, and someone has to notice when cash comes back and pay them. In a crunch the fastest bot grabs it first. Sluice replaces that operator with a Reactive contract." |
| 0:20 to 0:45 | The "How it works" diagram | "A repayment in Morpho, a market we don't control, or spare credit on another chain frees liquidity. A reactive contract on Lasna sees the event within about a second and tells the vault to pay the queue, first come, first served." |
| 0:45 to 1:30 | Terminal: `npx tsx src/flowB.ts --n 3 --x 10`, then the dashboard's live events | "Live on testnet: a withdrawal is queued, a borrower repays in Morpho, and the queue is paid in about a second and a half. The reactive transaction and the callback are on the explorers: the callback is sent by Reactive's signer, not by us. Nothing of ours is in the middle." |
| 1:30 to 2:15 | The race chart and table | "Why Omni? We raced it. A competitor bot tries to grab freed liquidity a few seconds after each repayment. At Omni speed the queue wins against anyone who waits a second or more. Slow the same system to legacy-like speed and it loses to every competitor under eight seconds. An instant bot beats us at either speed, and we show that too." |
| 2:15 to 2:40 | The flow C example links on the dashboard | "Cross-chain: Base can't cover the queue, so a relayer reserve fronts the payout in one hop. Only after seeing that confirmation does Reactive reimburse the relayer on Unichain, for exactly what was sent." |
| 2:40 to 3:00 | The README limitations, then the repo | "It can't create liquidity, and a same-block bot still wins. The code is open source, contracts are verified, and every number comes from live loops you can check on-chain." |

**After recording:** upload to YouTube as *unlisted*, check it plays in a private window, confirm it is under 3:00.

---

## 4. Final checklist

- [ ] Repository public. Check in a private window.
- [ ] README renders; results and addresses are real (they are generated)
- [ ] Dashboard hosted; link works in a private window
- [ ] Demo video under 3:00, link works in a private window
- [ ] Reactive contract has no debt and enough lREACT (`npm run status`)
- [ ] Submission made in the **Every Second Counts** track with: repo link, video link, addresses (Lasna), transaction hashes for flows B and C, the latency answer
- [ ] Open the build page logged out and click every link
