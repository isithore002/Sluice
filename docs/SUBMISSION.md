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
| Live dashboard | *host `dashboard/out` (see BUILD_GUIDE phase E), then paste the link. The site root is the landing page; the live state is at `<your-host>/dashboard/`* |
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

Independent actors (separate wallets, 6/6 loops, the deployer sent none of the transactions):
- Alice, a user, queues a withdrawal (Base Sepolia): `0xb24f813dd8d4a02ac2c3568381dc5c1e8f14d78fbd440883a07c9012e23f3d29`
- Bob, an outsider, repays on behalf of the borrower in Morpho (Base Sepolia): `0x20a27120464dcb3fe6ba1350f9a38eacad20481b07e91bfd736755ed4ed43041`
- Reactive transaction (Lasna): `0x64a55873a609c8f145a660902427a9665cb28de579b08a930c3ceff1c7b76da2`
- Callback pays Alice (Base Sepolia): `0xc23b0a8a33df6083edaaaf241723d92612a7d00119c1de73054b11527960326b`

Batch continuation (a callback pays at most 25 requests; 40 withdrawals from 40 separate wallets, paid by ONE repayment across 2 callbacks, no deposit or manual call in between):
- Repayment in Morpho (Base Sepolia): `0x27f7da1287439112f2f41740437fb01804c045635b893aebba03af029a4b3ba9`
- Omni request 1 (Lasna) `0x7bf06febfcfa9767a578f8f369f70f01732b2e4b14875ce9d4d774c202e4add4` → callback 1, 25 payments (Base Sepolia): `0x13907a69b2f84aa12fd832ddcbd947f4193b67ec0bec97b22e0b6959148ea31d`
- Omni request 2 (Lasna) `0x6f88ea2d86173972ad030bc737dd408f316731064b5cc64d109e1c6d1c1d14b8` → callback 2, 15 payments (Base Sepolia): `0xc884be68fd90e294adbfc4f789539955aefdf61a0eb9bbc246951311dbcf3746`

Outsider test of the README's "Try it yourself" steps, from a brand-new wallet `0xB11bAa7D2Ec33DeC6bd223B5A3cD22294dd80e65` that sent only 3 transactions:
- mint `0x3eae2a83024f102fe6930d892940208d5b52dc1832d7a9ad47962790f1e9b0ff`, approve `0xa124b832e66fedd9ee112b25c633a5c384cab5ce541e955a1271ec25c51f95b8`, repay `0x9131d956619a85301bb2cc8ea63597af986302a12ad5c60262003e63a0f52887`
- Reactive then settled the queue in `0xa78d7101e01e2417bd34428cb9b361aa38593ae1ef18d54d86e0b9685a77229e` (sent by Reactive's signer)

Only the origin transaction in each loop is sent by our wallet. The callbacks are sent by Reactive's signer (`0xF7E866D726658F6C3F14B8EE537fe268a4D91DDb`). Explorer links for these are in the README, and every loop's hashes are in `results/`.

**For Every Second Counts: what full-loop latency did you measure, and how?**

Each loop is traced end to end by the origin transaction's hash, which every callback carries and every event emits. A TypeScript harness (viem) records wall-clock milliseconds, polling every ~150 ms, and block timestamps, which only resolve to 1 s.

- **Flow B** (repayment → queue paid), 33/33 loops: median **1.58 s**, p95 2.10 s, max 2.20 s. Of that, repayment → Lasna react is 1.17 s.
- **Flow C** (shortfall → user paid by the reserve), 31/32 loops recorded: median **1.36 s**, p95 2.16 s. The relayer is reimbursed on Unichain at a median 4.60 s. All 32 loops completed on-chain; the one not counted lost its timings when the test harness's own cleanup call ran out of gas after the user was paid and the relayer reimbursed ([`docs/CASE_STUDY_FLOW_C.md`](CASE_STUDY_FLOW_C.md)).
- **Batch continuation** (one repayment, more queued withdrawals than a callback may pay): 40 withdrawals from 40 wallets were paid in strict first-come-first-served order by 2 callbacks (25 + 15), **2.97 s** after the single repayment, with the largest callback using 933,746 of its 1,500,000 gas limit.
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
- [ ] Re-arm the demo with `npm run arm` in `harness/` (it leaves one withdrawal queued; the dashboard's Withdrawal queue card must show 10 mUSD pending). Each settlement costs about 0.08 lREACT.
- [ ] Have the second wallet ready: a throwaway key with a little Base Sepolia ETH, and the README's three commands in a terminal.
- [ ] Don't show your `.env` file or any key.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:20 | The README problem section | "When a lending market runs out of cash, depositors can't withdraw. They join a queue, and someone has to notice when cash comes back and pay them. In a crunch the fastest bot grabs it first. Sluice replaces that operator with a Reactive contract." |
| 0:20 to 0:45 | The "How it works" diagram | "A repayment in Morpho, a market we don't control, or spare credit on another chain frees liquidity. A reactive contract on Lasna sees the event within about a second and tells the vault to pay the queue, first come, first served." |
| 0:45 to 1:30 | **Re-arm first** (`npm run arm`), then have a second wallet or a friend run the README's three "Try it yourself" commands live while the dashboard's live events are on screen (fallback: `npx tsx src/flowB.ts --n 3 --x 10`) | "Live on testnet: a withdrawal is queued, and someone else, a wallet we don't control, repays in Morpho. The queue is paid in about a second and a half. The reactive transaction and the callback are on the explorers: the callback is sent by Reactive's signer, not by us. Nothing of ours is in the middle." |
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
