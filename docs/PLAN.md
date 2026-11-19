# Sluice: Build Plan (Nov 19 → Dec 5, 2026)

**Deadline:** Sat Dec 5, 20:00 UTC. **Target submission: Fri Dec 4.** Dec 5 is buffer only.
**Mode:** solo, full-time, pairing. **You** write the vault, reactive contract, relayer reserve and dashboard. **I** write specs, mocks, tests, deploy scripts, the latency harness, the race bots and the docs, and review your code the same day you push it.

The spec is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Priority order if time runs short:**
1. Flows A + B live.
2. The latency race.
3. The dashboard.
4. Flow C (cross-chain), **the first thing cut**.

---

## Phase 0: Foundations

### Day 1 (Thu Nov 19): First live loop
- **Me:** scaffold the Foundry project. Pinned libs: `reactive-lib-omni@v0.1.0`, `reactive-test-lib` (`omni` branch), `system-smart-contracts@8f7b902`, OpenZeppelin, `morpho-blue`. Also `remappings.txt`, `foundry.toml` (solc 0.8.29), `.env.example` and `.gitignore`.
- **You:** port the Reactive **basic demo** (`omni` branch of the demos repo) and run it live: Base Sepolia event → Lasna → Base Sepolia callback.
- **Done when:** you have one live loop with three tx hashes saved in `notes/loops.md`.

### Day 2 (Fri Nov 20): Market up
- **Me:**
  - Mocks (`MockUSD`, `MockCollateral`, `FixedOracle`) and the deploy script.
  - Morpho market creation script.
  - Interface files with all events from the spec, and test skeletons.
  - Fork tests: create the market, borrow to 100%, repay, check the `Liquidate` data layout.
- **You:** run the scripts on Base Sepolia, then review the interfaces before writing against them.
- **Done when:** `marketId` is saved, borrow-to-100% plus repay works live, and the §11 checks for `irm = 0`, the oracle and `Liquidate` are ticked.

## Phase 1: Vault + Morpho path (the Execution gate)

### Days 3–4 (Sat Nov 21 – Sun Nov 22): SluiceVault
- **You:** `SluiceVault`: deposit, requestWithdraw, FIFO partial-fill queue, reservation rule, `_allocate`, `pullFromMorpho` (always emits `StateUpdated`), views.
- **Me:** unit and invariant tests (FIFO, conservation, reservation, auth, gas bound, no-op safety), plus a same-day review.
- **Done when:** all vault tests pass.

### Day 5 (Mon Nov 23): SluiceReactive v1
- **You:** `SluiceReactive` with subscriptions 1–4:
  - The `StateUpdated` and Morpho handlers, and the pull callback.
  - **The `Liquidate` bad-debt halt.**
  - **Delay mode** (`delayBlocks` + Cron1).
  - **Pull retries** (Cron10, backoff, cap of 3).
  - `resync`, `Handled` events and `coverDebt()`.
- **Me:** `reactive-test-lib` full-cycle tests for flow B, plus delay mode, retry cap and the halt.
- **Done when:** the flow B full cycle passes locally, including a dropped-event scenario.

### Day 6 (Tue Nov 24): First live Sluice loop (Execution gate)
- **Me:** deploy and funding scripts for all three chains, and a one-shot "repay → settle" loop script.
- **You:** deploy and debug live.
- **Done when:** a Morpho repay on Base pays a queued withdrawal through Lasna, with tx hashes for all three hops. **The Execution gate is met, and from here we always have a submittable entry.**

## Phase 2: The latency race

### Day 7 (Wed Nov 25): Race v1 + go/adjust checkpoint
- **Me:**
  - Latency harness (TypeScript + viem, traced by `traceId`, wall-clock milliseconds plus block timestamps, written to `results/*.json`).
  - Race bots: borrower (repays), competitor (withdraws `C` seconds after `Repay`).
  - A summary script for capture rate, median, p95 and success rate.
- **Both:** set up the competitor's supply, then run a first matrix of at least 5 rounds per cell, Sluice {native, `delayBlocks = 6`} × C {2s, 4s, 6s}.
- **Checkpoint (evening):**
  - **If native clearly out-captures ~7s:** proceed as planned. The race chart becomes the headline.
  - **If there's no meaningful difference:** still proceed, since the loop works. Shift the pitch to fairness and no operator, and treat flow C as optional from now on.

## Phase 3: Cross-chain (the first thing cut)

### Days 8–9 (Thu Nov 26 – Fri Nov 27): Reserve + Sibling + reactive v2
- **You:**
  - `RelayerReserve`: idempotent `front`, re-emits `Fronted` on repeat.
  - `SiblingVault`: **safety buffer**, idempotent `reimburse`, `ReimburseFailed`.
  - Reactive v2: subscriptions 5–9, per-fill stages, **reimburse only after `Fronted` for the amount actually sent**, fill retries, the `creditReserved()` math, `retryFill` and `closeFill`.
- **Me:** tests for reimburse-matches-sent, no reimbursement for unfronted fills, safety buffer, healing with dropped `Fronted` or `Reimbursed`, the retry cap, and the halt blocking fronts. Plus a flow C full cycle.
- **Done when:** flow C passes locally, including the failure scenarios.

### Day 10 (Sat Nov 28): Live cross-chain + full latency runs
- **Both:**
  - Deploy v2 live.
  - Run at least 30 loops each for flows B and C.
  - Rerun the race matrix to at least 10 rounds per cell.
- **Cut checkpoint (evening):** if flow C isn't live, **cut it**. Ship flows A + B and the race results, and document flow C as a design with passing local full-cycle tests.

## Phase 4: Dashboard

### Days 11–13 (Sun Nov 29 – Tue Dec 1)
- **You:** Next.js + wagmi/viem dashboard showing:
  - **The race chart** (capture rate against competitor delay, native vs ~7s).
  - Queue state (pending, shortfall, requests).
  - A live event feed across the three chains.
  - Per-loop latency.
  - Explorer links for every hop.
  - Callback-contract reserves and debt.
- **Me:** data and hook spec, reviews, and filling gaps.
- **Done when:** the dashboard shows a live loop end to end, plus the race chart.

> **Cut checkpoint (Tue Dec 1, evening):** if the dashboard isn't working, ship a single status page with the race chart and the latest loop.

## Phase 5: Polish and submit

### Day 14 (Wed Dec 2): Hardening + stretch
- Stretch: a fairness script that tries to jump the queue and visibly fails.
- Debt and reserve top-ups. Final fresh runs (30 loops per flow, plus the full race matrix).

### Day 15 (Thu Dec 3): Docs + video
- **Me:** README (pitch, race chart, architecture diagram, how to run, latency and race method, results, addresses, tx hashes, limitations and "claims we don't make"), the demo video script, and drafts of the submission form answers.
- **You:** record the demo video (under 3 minutes).

### Day 16 (Fri Dec 4): Submit
- Make the repo public. Submit on DoraHacks with addresses (on Lasna), tx hashes, the latency and race answer and the video.
- **Dec 5 is buffer only.**

---

## Demo video outline (under 3 minutes)

| Time | Content |
|---|---|
| 0:00–0:20 | The problem: depositors stuck at 100% utilization (Nov 2025, Apr 2026). Freed liquidity goes to whoever is fastest. |
| 0:20–0:45 | How Sluice works: one diagram, the queue pays itself |
| 0:45–1:30 | Live flow B: queued withdrawal → Morpho repay → paid, with a latency overlay |
| 1:30–2:15 | **The race:** capture rate at Omni ~1s against ~7s, competitors at 2/4/6s. This is the "why Omni" moment. |
| 2:15–2:40 | Flow C (if shipped): Base short → front from the reserve in one hop → relayer reimbursed on Unichain |
| 2:40–3:00 | Limitations and the repo link |

## Submission form answers (to draft on Day 15)

1. Deployed contract addresses and network (Lasna).
2. Transaction hashes for the full loop, origin → callback, for flow B (and C if shipped).
3. **The full-loop latency and race results, and how they were measured** (traceId method, wall-clock milliseconds plus block timestamps, N loops, the race matrix and the delay-mode caveat).
4. First time with Reactive? (Yes.) First smart contract? (No.)
5. The hardest part of building with Reactive. Keep notes as we go.
6. How you heard about the buildathon.

## Daily rhythm

- Each morning: pick that day's "done when" item.
- You push code, and I review it the same day.
- Each evening: log tx hashes and any surprises in `notes/loops.md`. They become README material and form answer #5.
