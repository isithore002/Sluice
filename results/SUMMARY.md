# Sluice measurement summary

Generated 2026-11-19T09:54:25.041Z.

## Flow B: Morpho repayment → queue paid (one reactive hop)

Succeeded 33/33.

| Measure | Median | p95 | Max |
|---|---|---|---|
| Repay → queue paid (wall clock) | 1.58 s | 2.10 s | 2.20 s |
| Repay → Lasna react (wall clock) | 1.17 s | 1.83 s | 1.99 s |
| Lasna react → Base callback (wall clock) | 0.41 s | 0.75 s | 1.34 s |
| Repay → queue paid (block timestamps, 1 s resolution) | 1 s | 2 s | 2 s |

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
