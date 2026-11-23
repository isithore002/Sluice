# Slither findings and our reading of them

[Slither](https://github.com/crytic/slither) 0.11.6 runs in CI on every push (the `Slither static analysis` job) and reports without failing
the build on findings. It is a pattern matcher: it flags code that *looks like* a known bug class, so most findings need a human to
decide whether the pattern is reachable. This page is that decision for the current code. It is **our own reading, not an audit**, and
nothing here changes what the contracts do.

Run on `src/` with mocks, the demo helper, tests, scripts and libraries filtered out: **72 results across 47 contracts and 102
detectors** (2 High, 12 Medium, 40 Low, 18 Informational). Reproduce with `pip install slither-analyzer==0.11.6`, then
`slither . --filter-paths "lib|test|script|mocks|demo" --no-fail-pedantic`.

## High (2): reentrancy-eth, in the new Lifeline contracts

`LifelineFunder.rescue` and `LifelineReactive._rescueLocal` move the sponsor's budget out before paying the debt, then **put it back if the
payment call fails**. Slither flags the put-back because it writes state after an external call that sent value.

Why we read this as safe:

- The write after the call is only in the `catch` branch, that is, when the call **reverted**. A reverted call rolls back everything a
  re-entry could have done inside it, so there is no state left for a re-entry to have corrupted.
- On success there is no write after the call.
- The callee is a fixed address: the callback proxy (`LifelineFunder`) or the Reactive system contract (`LifelineReactive`). It is not a
  caller-chosen address. The proxy's `depositTo` only adjusts balances and may emit `WhitelistContract`.
- `rescue` can only be entered by the callback proxy carrying our Reactive contract's address (`onlyServiceProvider`, `onlyCallbackSender`).

What we did **not** do: add a reentrancy guard or comments to these contracts. They are deployed on Base Sepolia and Lasna and the live
probe evidence refers to that exact code, so the source was left as deployed. A guard would be cheap hardening for a future version.

## Medium (12)

| Finding | Where | Our reading |
|---|---|---|
| reentrancy-no-eth (4) | `SluiceVault.requestWithdraw`, `poke`, `pullFromMorpho` | External calls go to Morpho Blue (fixed) and the loan token. Every entry point of the vault that moves funds is `nonReentrant`, so state written after those calls cannot be re-entered through the vault. The token is a plain ERC-20 with no transfer hooks. |
| reentrancy-no-eth (4) | `SluiceReactive._onFronted`, `_onCredit`, `_onCron10` | The only external calls are `SYSTEM.subscribe`, `unsubscribe` and `requestCallbackV_1_0`. In the system-contract source each of these only **emits an event** for the network to act on, so none can call back into the contract. `react()` is `onlySystem`. |
| incorrect-equality | `SluiceVault._settle` | `r.remaining == 0` compares a bookkeeping amount, not a token balance, so a balance cannot be manipulated into or out of it. |
| uninitialized-local | `SluiceVault._settle` | `fills` is a counter that is meant to start at 0. |
| unused-return (2) | `SluiceVault._withdrawFromMorpho`, `_allocate` | Morpho's returned share counts are not needed: the call is made with an exact asset amount and Morpho reverts on failure. |

## Low and informational (58)

- **reentrancy-events (24), reentrancy-benign (5):** an event is emitted after an external call. Same call targets as above.
- **missing-zero-check (9):** address arguments to constructors and one-time setters are not checked against the zero address. Worth tightening in a future version; the deployed addresses were set by the deploy scripts.
- **timestamp (2):** the Lifeline cooldown compares `block.timestamp` to a stored time. Second-level drift does not matter for a cooldown measured in tens of seconds.
- **low-level-calls (1):** `LifelineFunder.withdraw` pays the sponsor with a low-level call and reverts if it fails.
- **naming-convention (13), unindexed-event-address (3), cyclomatic-complexity (1):** style. The trailing-underscore parameter names are a project convention.

## Not covered

Slither does not prove correctness. Behaviour such as first-come-first-served order, conservation and "nothing is paid twice" is checked
separately by the stateful fuzz suites in `test/invariant/`, which are fuzzed, not formally proven. None of this replaces an independent audit.
