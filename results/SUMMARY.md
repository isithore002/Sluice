# Sluice measurement summary

Generated 2026-11-25T13:30:03.966Z.

## Flow B: Morpho repayment → queue paid (one reactive hop)

Succeeded 104/104.

| Measure | Median | p95 | Max |
|---|---|---|---|
| Repay → queue paid (wall clock) | 1.32 s | 1.79 s | 2.44 s |
| Repay → Lasna react (wall clock) | 1.22 s | 1.99 s | 2.92 s |
| Lasna react → Base callback (wall clock) | 0.05 s | 0.60 s | 1.34 s |
| Repay → queue paid (Base block numbers × 200 ms) | 1.20 s | 1.80 s | 2.00 s |
| Repay → queue paid (block timestamps, 1 s resolution) | 1 s | 2 s | 2 s |

The block-number row is (block of the payout callback − block of the repayment) × 200 ms, because Base Sepolia makes a block every 200 ms while block timestamps only have 1 s resolution. Every loop's record in `results/flowB-*.json` holds both transaction hashes (`txs.origin`, `txs.callback`) and both block numbers (`blocks.origin`, `blocks.callback`), so the figure can be recomputed from them. It assumes the 200 ms cadence held between those two blocks.

## Flow C: Base shortfall → fronted by reserve, reimbursed on Unichain

Succeeded 31/32.

| Measure | Median | p95 | Max |
|---|---|---|---|
| Request → user paid (wall clock) | 1.36 s | 2.16 s | 2.19 s |
| Request → relayer reimbursed (wall clock) | 4.60 s | 5.08 s | 5.31 s |

## Independent actors: separate wallets for the user and the repayer

Succeeded 6/6; every loop's repayment, withdrawal request and payout involved addresses other than the deployer: true.

| Measure | Median | p95 | Max |
|---|---|---|---|
| Repay (by an outsider) → queue paid (wall clock) | 1.56 s | 1.75 s | 1.75 s |

## Batch continuation: one repayment, more queued withdrawals than one callback may pay

40 withdrawals queued by 40 separate wallets, then ONE repayment. The vault pays at most 25 per callback, so Reactive scheduled the next batch itself: 2 callbacks (25 + 15 payments). Request ids were paid in strict FIFO order: true.

| Measure | Value |
|---|---|
| Repay → first batch paid (wall clock) | 1.93 s |
| Repay → queue empty (wall clock) | 2.97 s |
| Largest callback gas / limit | 933,746 / 1,500,000 |

## The cross-chain loop that is not in the measured numbers

32 of 32 cross-chain loops completed on-chain (user paid, relayer reimbursed); 31 were measured. The other one finished correctly, then the harness's own cleanup call `commitCredit()` ran out of gas (34,915 of 34,915) before the loop's timings were saved. Full reconstruction in results/case-study-flowC.json and docs/CASE_STUDY_FLOW_C.md.

## Latency race: share of contested liquidity captured by the queue

| Sluice speed | Competitor delay | Rounds | Queue capture | Sluice acted (median) |
|---|---|---|---|---|
| Omni native | 0 s | 6 | 17% | 1.44 s |
| Omni native | 1 s | 6 | 100% | 1.72 s |
| Omni native | 2 s | 6 | 100% | 1.46 s |
| Omni native | 4 s | 6 | 100% | 1.19 s |
| Omni native | 8 s | 6 | 100% | 1.28 s |
| +6 Lasna blocks (~legacy) | 0 s | 6 | 0% | 7.76 s |
| +6 Lasna blocks (~legacy) | 1 s | 6 | 0% | 7.84 s |
| +6 Lasna blocks (~legacy) | 2 s | 6 | 0% | 7.42 s |
| +6 Lasna blocks (~legacy) | 4 s | 6 | 0% | 7.66 s |
| +6 Lasna blocks (~legacy) | 8 s | 6 | 100% | 7.50 s |

Wall-clock times are measured by the harness polling every ~150 ms, so each includes up to one poll interval of observation delay. The ~legacy rows add delay on Omni; they are not runs on the legacy network.
