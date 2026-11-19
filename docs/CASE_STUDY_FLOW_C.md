# Case study: the one cross-chain loop that is not in the numbers

**Short version.** The README reports flow C as 31/32. All 32 cross-chain loops completed on-chain: the user was paid and the relayer was reimbursed every time. One loop is missing from the latency table because the test harness's own cleanup step failed before it saved that loop's timings. Nothing about the protocol failed.

Everything below is reconstructed from chain data by `npm run casestudy` (in `harness/`) and stored in [`results/case-study-flowC.json`](../results/case-study-flowC.json). The dashboard shows the same reconstruction at `/dashboard#case`.

## What was reported

The 30-loop flow C run ([`results/flowC-2026-11-19T09-01-51-039Z.json`](../results/flowC-2026-11-19T09-01-51-039Z.json)) recorded loop 0 as:

```json
{ "flow": "C", "i": 0, "ok": false, "error": "Error: uni commitCredit reverted: 0x4ed65cfd…4591" }
```

Together with a 2-loop rerun that is 32 attempts and 31 recorded successes.

## What actually happened

A flow C loop has two parts: the protocol (queue a withdrawal that Base can't cover, have the reserve front it, reimburse the relayer on Unichain) and the harness's cleanup (put the money back so the next loop can start).

| Part | Step | Result |
|---|---|---|
| Protocol | The user asks to withdraw 10 mUSD (request #136), queued with a shortfall | ✓ |
| Protocol | Omni reacts and asks the reserve to front the shortfall | ✓ |
| Protocol | The reserve fronts 10 mUSD and the vault pays request #136 in full | ✓ |
| Protocol | Omni sees `Fronted` and asks Unichain to reimburse exactly what was sent | ✓ |
| Protocol | The sibling vault reimburses the relayer 10 mUSD | ✓ |
| Protocol | Omni closes fill #1, which ends in stage `DONE` | ✓ |
| Harness cleanup | Put the reimbursed amount back into the sibling vault | ✓ |
| Harness cleanup | `commitCredit()` on the sibling vault | ✗ out of gas |

Every transaction is linked in the [README table](../README.md#the-cross-chain-loop-that-is-not-in-the-numbers). The failed call was sent with a gas limit of 34,915 and used all 34,915: the node's gas estimate came up just short on Unichain Sepolia, so the transaction ran out of gas.

## Why it counted as a failure

The harness only builds a loop's result object after the cleanup finishes. The cleanup threw, so the loop was recorded as `ok: false` with no timings, even though the payout and the reimbursement had already happened. That is why the latency table has 31 loops, not 32, and why the numbers neither include nor exclude anything unfavourable: the loop simply has no recorded timings.

## What we changed

Every harness transaction now carries a 30% buffer over the node's gas estimate ([`harness/src/util.ts`](../harness/src/util.ts)). The 2-loop rerun after the change succeeded and is published next to the original ([`results/flowC-2026-11-19T09-14-20-131Z.json`](../results/flowC-2026-11-19T09-14-20-131Z.json)).

## What this does and does not show

- It shows the payout and the reimbursement happened for all 32 loops. The evidence is the on-chain events, not the harness's own bookkeeping.
- It does **not** add a latency sample: the missing loop has no wall-clock measurement, so the medians and percentiles are computed from the 31 recorded loops only.
- It does not claim a failure rate for the protocol under adverse conditions: 32 loops on a testnet we staged ourselves is a demonstration, not a reliability study.

## Reproduce

```bash
cd harness
npm run casestudy      # rebuilds results/case-study-flowC.json from the chains
```

The script finds the failed transaction named in the recorded error, then walks the loop from the `Reimbursed` event just before it (its trace id is the hash of the loop's origin transaction). It refuses to write the file if any claim above stops being true: the failed call must have used its whole gas limit, the loop's payout and reactions must be found on-chain, and `harness/src/util.ts` must still carry the gas buffer.
