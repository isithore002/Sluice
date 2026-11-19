# Sluice: Architecture & Spec

**Sluice makes withdrawal queues settle themselves.** When a vault on Base Sepolia runs out of free liquidity, withdrawals queue up first come, first served. A reactive contract on Reactive Lasna watches every place liquidity can come back from, and pays the queue within seconds, with no manager and no bot. Liquidity comes back from:

- **Repayments** in a third-party Morpho Blue market.
- **Pre-committed surplus** in a sibling vault on Unichain Sepolia.

Track: **Every Second Counts**. Networks: Reactive Lasna, Base Sepolia, Unichain Sepolia.

**Headline evidence:** a measured **latency race**. Sluice at Omni speed (~1s) is compared with the same system slowed to legacy speed (~7s), against competitors that grab freed liquidity after a delay. Section 6 has the details.

---

## 1. Verified facts (checked Nov 19, 2026)

| Item | Value | Source |
|---|---|---|
| Lasna chain ID / RPC / explorer | `5318007` / `https://lasna-rpc.rnk.dev/` / `https://lasna.reactscan.net/` | dev.reactive.network/reactive-mainnet |
| System contract (Lasna + mainnet) | `0x8888888888888888888888888888888888888888` | docs |
| Base Sepolia chain ID / callback proxy | `84532` / `0x476F44b11F5C942c58f4c8E3d0300E5710743585` | dev.reactive.network/origins-and-destinations |
| Unichain Sepolia chain ID / callback proxy | `1301` / `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` | same |
| Morpho Blue on Base Sepolia | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`. Confirmed live: `owner()` answers, IRM `address(0)` enabled, LLTVs 0 / 38.5 / 62.5 / 77 / 86 / 91.5 / 94.5 / 96.5 / 98% enabled | on-chain `cast call` |
| Morpho Blue on Unichain Sepolia | **Not deployed** at that address | on-chain |
| Aave v3 on Base Sepolia | Pool `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27`, 6 reserves (not used) | on-chain |
| Block timing | Base Sepolia: about 5 blocks share each 1-second timestamp. Unichain Sepolia and Lasna: 1s blocks, 1s timestamps | on-chain sampling |
| Cron events | Emitted by `0x0000000000000000000000000000000000fffFfF`. Subscribe with `chainId = block.chainid`. Cron1 topic0 `0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514` (every block, ~1s). Cron10 topic0 `0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687` (~10s). **Billed on every tick,** so subscribe only while needed | docs/reactive-contracts |
| Reactive tx gas cap | 900,000 | docs/economy |
| Callback gas limit | Minimum 100,000. Requests below it are silently ignored. The proxy keeps some of the gas for its own overhead | docs/economy |
| Who pays | Reactive contract pays lREACT for `react()`. **Callback recipients pay in the destination chain's native ETH** via the callback proxy. Reverted calls are still billed. Any debt stops delivery | docs/economy |
| Callback auth | Payload's first argument is an `address` placeholder that the network overwrites with the reactive contract's address. Use **both** `onlyServiceProvider` and `onlyCallbackSender(rvm)` | docs/callback-contracts |
| Deploy order | Reactive contract first, then callback contracts (sender is immutable), then an owner setter on the reactive side subscribes | docs |
| Library | `Reactive-Network/reactive-lib-omni@v0.1.0`, imports `@reactive/src/...`, `pragma ^0.8.29` | GitHub |
| Test library | `Reactive-Network/reactive-test-lib`, **`omni` branch**. It runs the real Omni system contracts and replays multi-hop flows. It does **not** support callbacks into the Reactive chain itself | GitHub README (omni branch) |
| Demos | `reactive-smart-contract-demos` `main` is legacy; the **`omni` branch** has the Omni versions | GitHub |
| Deadline | `2026-12-05 20:00 UTC` | DoraHacks page data |

---

## 2. Design decisions

| Decision | Choice | Why |
|---|---|---|
| External market | **Morpho Blue (real deployment), our own isolated market** | It's real third-party code we can't modify. We can drive utilization to 100% on demand without touching anyone else's funds. Every Morpho event has the market `id` as `topic1`, so we can subscribe to exactly our market. |
| Interest rate model | `irm = address(0)` | No interest accrual, so balances are exact and the demo is deterministic. Documented as a simplification. |
| Asset | **`MockUSD` (6 decimals, open mint) on Base and Unichain** | We create the market, so we choose the token. Unlimited mint allows many demo and race loops. |
| New-deposit settle | **Synchronous inside the vault, not through Reactive** | A deposit into our own vault can pay the queue in the same transaction. Reactive handles what a vault can't do alone: other protocols and other chains. |
| Cross-chain | **Sequenced: front first, reimburse after `Fronted` is seen, for the amount actually sent** | The user is still paid after one hop; only the relayer waits an extra hop. The relayer can never be reimbursed for a front that didn't happen, and never for more than it sent. |
| Cross-chain safety | Unichain only commits surplus **above a safety buffer**. **All fronting halts if our Base market records bad debt.** | Stops Sluice from spreading losses from a troubled market to healthy depositors on the other chain. |
| Robustness | **Absolute-value events, idempotent destinations that re-emit their result on repeat, capped retries with backoff, and an owner `resync`** | Missed or failed deliveries heal themselves, and a stuck state can always be repaired. |
| Retry clock | **Cron10, subscribed only while something is in flight** | Gives the reactive contract a timer without being billed for idle ticks. |
| "Why Omni" evidence | **Latency race with a delay mode** (`delayBlocks`) | The same contracts run at native ~1s and at an injected legacy-like ~7s, raced against competitor bots. |
| Shares | 1 share = 1 asset unit (no yield, because irm = 0) | Keeps accounting simple. A full ERC-7540 implementation is future work. |
| Tracing | `traceId` = origin tx hash, carried through every callback and every event | Lets the harness join all hops without guessing. |

---

## 3. Components

```
 Base Sepolia (84532)                 Reactive Lasna (5318007)            Unichain Sepolia (1301)
┌──────────────────────────┐        ┌────────────────────────────┐      ┌───────────────────────┐
│ Morpho Blue (3rd party)  │─Repay─▶│                            │      │                       │
│  our isolated market     │ Supply │       SluiceReactive       │◀─────│ SiblingVault          │
│                          │ Liq.   │                            │Credit│  surplus above safety │
│ SluiceVault              │─State─▶│  absolute caches + per-    │      │  buffer → credit      │
│  FIFO queue, reservation │        │  fill status, retries,     │      │                       │
│  pullFromMorpho() ◀──────┼────────│  delay mode, bad-debt halt │──2───┼─▶ reimburse(fillId)   │
│                          │        │                            │      └───────────────────────┘
│ RelayerReserve           │─Front─▶│   Cron1 (delay mode) and   │
│  front(fillId) ◀─────1───┼────────│   Cron10 (retries), only   │
└──────────────────────────┘  -ed   │   while needed             │
                                    └────────────────────────────┘
   1 = front first (pays the user)    2 = reimburse after Fronted is seen
```

| Contract | Chain | Base class | Written by |
|---|---|---|---|
| `MockUSD`, `MockCollateral`, `FixedOracle` | Base (+ MockUSD on Unichain) | OZ ERC20 | Me |
| `SluiceVault` | Base | `AbstractCallback` | You |
| `RelayerReserve` | Base | `AbstractCallback` | You |
| `SiblingVault` | Unichain | `AbstractCallback` | You |
| `SluiceReactive` | Lasna | `AbstractReactive` | You |
| Harness, race bots, deploy scripts | Off-chain | TypeScript + viem, forge scripts | Me |

---

## 4. Contract specs

### 4.1 Mocks (Base, plus MockUSD on Unichain)

- `MockUSD`: ERC20, 6 decimals, `mint(address to, uint256 amount)` open to anyone. Testnet only.
- `MockCollateral`: ERC20, 18 decimals, open mint. The demo borrower posts it to borrow MockUSD.
- `FixedOracle`: Morpho `IOracle.price()` returns a constant. For 1 collateral (18 decimals) = 1 MockUSD (6 decimals) at Morpho's `1e36` scale: `1e36 * 1e6 / 1e18 = 1e24`. **Verify against `ConstantsLib.ORACLE_PRICE_SCALE` in a fork test.**
- Market: `{loanToken: MockUSD, collateralToken: MockCollateral, oracle: FixedOracle, irm: address(0), lltv: 0.86e18}`. `marketId = keccak256(abi.encode(marketParams))`.

### 4.2 `SluiceVault` (Base)

`AbstractCallback(proxy = 0x476F…5585, sender = SluiceReactive)`, Ownable.

**State**
- `asset`, `morpho`, `marketParams`, `marketId`, `reserve`
- `mapping(address => uint256) shares`
- `Request[] queue` with `struct Request { address owner; uint256 remaining; }`, plus `head` and `pendingTotal`
- `bufferTarget`: idle assets kept in the vault; anything above it is supplied to Morpho

**User functions**
- `deposit(uint256 assets)`: pull tokens and mint shares. Then **`_settle(0)` synchronously**, then `_allocate()` only if the queue is empty. Ends with `_emitState(0)`.
- `requestWithdraw(uint256 assets) returns (uint256 requestId)`: burn shares.
  - If the queue is empty and `idle + morphoWithdrawable() >= assets`, pay immediately, withdrawing from Morpho if needed.
  - Otherwise enqueue and emit `WithdrawQueued`.
  - Ends with `_emitState(0)`.

**Callback functions** (both guards)
- `pullFromMorpho(address rvm, uint256 traceId)`: `amt = min(pendingTotal - idle, morphoWithdrawable())`. If `amt > 0`, call `morpho.withdraw(marketParams, amt, 0, address(this), address(this))`. Then `_settle(traceId)` and **always** `_emitState(traceId)`, even when nothing changed, because that event is the reactive contract's confirmation. **Never revert when there's nothing to do.**

**Reserve hook**
- `onFronted(uint256 fillId, uint256 amount, uint256 traceId)`: `require(msg.sender == reserve)`, then `_settle(traceId)` and `_emitState(traceId)`.

**Views**
- `morphoWithdrawable() = min(vault's supply assets in our market, totalSupplyAssets - totalBorrowAssets)`.
- `shortfall() = max(0, pendingTotal - idle - morphoWithdrawable())`

**Internal**
- `_settle(traceId)`: FIFO with partial fills. Starting at `head`, up to `MAX_FILLS_PER_CALL = 25`:
  1. `pay = min(idle, req.remaining)`, then transfer to `req.owner`.
  2. `req.remaining -= pay`, `pendingTotal -= pay`.
  3. Emit `WithdrawSettled`.
  4. Advance `head` when `remaining == 0`. Stop when `idle == 0`.
- `_emitState(traceId)`: `emit StateUpdated(pendingTotal, shortfall(), traceId)`. Both values are **absolute**.

**Reservation rule (fairness)**
While `pendingTotal > 0`:
- `requestWithdraw` always enqueues; it never pays instantly.
- Idle assets only leave the vault to pay the queue.
- `_allocate()` is a no-op.

**Events**
```solidity
event Deposited(address indexed owner, uint256 assets);
event WithdrawQueued(uint256 indexed requestId, address indexed owner, uint256 assets);
event WithdrawPaidInstantly(address indexed owner, uint256 assets);
event WithdrawSettled(uint256 indexed requestId, address indexed owner, uint256 paid, uint256 remaining, uint256 traceId);
event StateUpdated(uint256 pendingTotal, uint256 shortfall, uint256 traceId); // the reactive contract subscribes to this
```

### 4.3 `RelayerReserve` (Base)

`AbstractCallback(proxy = 0x476F…5585, sender = SluiceReactive)`.

**State**
- `asset`, `vault`, `relayer`
- `struct Fill { bool done; uint256 requested; uint256 sent; }`
- `mapping(uint256 => Fill) fills`

**Functions**
- `fund(uint256)` and `withdrawInventory(uint256)`: relayer only. Both emit `InventoryUpdated(balance)`.
- `front(address rvm, uint256 fillId, uint256 amount, uint256 traceId)` (both guards):
  1. **First time for this fill only:** `sent = min(amount, balance)`, store the fill, and transfer `sent` to the vault.
  2. **Always**, including repeats and `sent == 0`: call `vault.onFronted(fillId, sent, traceId)`, so the vault publishes fresh absolute state (`StateUpdated`).
  3. Then emit `Fronted(fillId, requested, sent, inventory, traceId)` with the stored values.

  **The ordering matters.** SluiceReactive always sees the vault's current shortfall *before* the confirmation. So even if it missed both events of the original execution, a retry can't make it front the same shortfall twice. The test suite found this case; see `test_crossChain_bothEventsMissed_retryDoesNotDoubleFront`.

```solidity
event Fronted(uint256 indexed fillId, uint256 requested, uint256 sent, uint256 inventory, uint256 traceId);
event InventoryUpdated(uint256 inventory);
```

### 4.4 `SiblingVault` (Unichain)

`AbstractCallback(proxy = 0x775c…66C1, sender = SluiceReactive)`.

**State**
- `asset` (Unichain MockUSD), `relayerPayee`
- **`safetyBuffer`**: owner-set; this amount never becomes credit
- `creditAvailable`
- `mapping(uint256 => bool) paid`

**Functions**
- `deposit(uint256)` and `withdraw(uint256)`. Withdrawals may only use `balance - creditAvailable`.
- `commitCredit()`: `creditAvailable = max(creditAvailable, balance - safetyBuffer)` (when positive). Emits `CreditCommitted(creditAvailable)`.
- `reimburse(address rvm, uint256 fillId, uint256 amount, uint256 traceId)` (both guards):
  - If `paid[fillId]`, re-emit `Reimbursed` and return.
  - If `amount > creditAvailable`, emit `ReimburseFailed(fillId, amount, creditAvailable)` and return without marking it paid, so it can be retried. **Don't revert.**
  - Otherwise decrement credit, transfer to `relayerPayee`, set `paid[fillId] = true`, and emit `Reimbursed`.
- **`amount` is always the reserve's `sent` value, never the requested value.** The reactive contract guarantees this (§4.5).

```solidity
event CreditCommitted(uint256 creditAvailable);
event Reimbursed(uint256 indexed fillId, uint256 amount, uint256 creditAvailable, uint256 traceId);
event ReimburseFailed(uint256 indexed fillId, uint256 amount, uint256 creditAvailable);
```

### 4.5 `SluiceReactive` (Lasna)

`AbstractReactive`, payable constructor, owner. Expose `coverDebt()`.

**Configuration**
`configure(vault, reserve, sibling, morpho, marketId)` is owner-only and called once after the callback contracts are deployed. It subscribes to:

| # | Chain | Contract | topic0 | topic1 |
|---|---|---|---|---|
| 1 | 84532 | vault | `StateUpdated` | ignore |
| 2 | 84532 | morpho | `Repay` | `marketId` |
| 3 | 84532 | morpho | `Supply` | `marketId` |
| 4 | 84532 | morpho | `Liquidate` | `marketId` |
| 5 | 84532 | reserve | `Fronted` | ignore |
| 6 | 84532 | reserve | `InventoryUpdated` | ignore |
| 7 | 1301 | sibling | `CreditCommitted` | ignore |
| 8 | 1301 | sibling | `Reimbursed` | ignore |
| 9 | 1301 | sibling | `ReimburseFailed` | ignore |
| (dynamic) | `block.chainid` | `0x…fffFfF` | Cron1 / Cron10 | ignore |

Morpho events, verified against `EventsLib.sol`:
- `Repay(Id indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)`
- `Supply(Id indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)`
- `Liquidate(Id indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)`

Compute the topic0 values with `cast sig-event`, and confirm the `Liquidate` data layout in a fork test.

**State**
- **Absolute caches**, overwritten by every matching event: `pending`, `shortfall`, `inventory`, `credit`.
- **Per-fill status:** `struct Fill { uint256 requested; uint256 sent; uint8 stage; uint8 attempts; uint256 lastTryBlock; }`, where `stage` is `FRONTING`, `REIMBURSING`, `DONE` or `GAVE_UP`. Also `uint256[] openFills` and `fillNonce`.
- In-flight amounts are **derived** from open fills, never kept as running counters.
- **Pull status:** `pullPending`, `pullAttempts`, `pullLastTryBlock`, `pullDueBlock` (delay mode), `pullTrace`.
- `delayBlocks` (0 = native speed) and `halted` (bad-debt switch).
- `cron1On`, `cron10On`.

**`react(log)` routing** (route on `topic0` and check `opCode`; **never revert to filter**)

| Event | Action |
|---|---|
| `StateUpdated(pending, shortfall, trace)` | Overwrite the caches. Clear `pullPending` and reset `pullAttempts`.<br>**Pull:** if `pending > shortfall` and no pull is pending, request a pull.<br>**Front:** if `!halted`, `x = min(shortfall ⊖ inFlightFront(), inventory ⊖ inFlightFront(), credit ⊖ creditReserved())`. Here `⊖` is subtraction that floors at 0, `inFlightFront()` is the sum of `requested` over fills in `FRONTING`, and `creditReserved()` is `FRONTING.requested + REIMBURSING.sent`, since every open fill will need credit. If `x > 0`: open fill `++fillNonce` with stage `FRONTING`, request **only** Base `reserve.front(fillId, x, trace)`, and turn Cron10 on. |
| Morpho `Repay` / `Supply` (our market) | If `pending > 0`: with `delayBlocks == 0`, request a pull now (unless one is pending). With `delayBlocks > 0`, set `pullDueBlock = block.number + delayBlocks` and turn **Cron1** on. |
| Morpho `Liquidate` (our market) | Decode `badDebtAssets`. If it's above 0, set **`halted = true`** and emit `Halted(trace)`. Otherwise treat it like `Repay`. |
| `Fronted(fillId, requested, sent, inventory, trace)` | Overwrite `inventory`. If the fill's stage is `FRONTING`: store `sent`. If `sent > 0`, set stage `REIMBURSING` and request Unichain `sibling.reimburse(fillId, sent, trace)`. If `sent == 0`, set stage `DONE`. |
| `Reimbursed(fillId, amount, creditAvailable, trace)` | Overwrite `credit`. Set the fill's stage to `DONE` and remove it from `openFills`. |
| `ReimburseFailed(fillId, amount, creditAvailable)` | Overwrite `credit`. Leave the fill in `REIMBURSING` so the retry tick tries again. |
| `CreditCommitted(c)` / `InventoryUpdated(inv)` | Overwrite the cache. |
| Cron1 tick (delay mode only) | If `block.number >= pullDueBlock`, request the pull and turn Cron1 off. |
| Cron10 tick (retries) | **Pull:** if `pullPending` and `block.number - pullLastTryBlock >= 10 << pullAttempts`, re-request the pull and increment `pullAttempts`. Stop after **3 attempts** and emit `GaveUp(0)`.<br>**Fills:** same backoff for each open fill. Re-send `front` (stage `FRONTING`) or `reimburse` (stage `REIMBURSING`); both are idempotent and re-emit their result. After **3 attempts**, set stage `GAVE_UP` and emit `GaveUp(fillId)`.<br>Turn Cron10 off when nothing is pending or open. |

**Owner functions**
- `resync(pending, shortfall, inventory, credit)`: overwrite the caches with values read using `cast`.
- `retryFill(fillId)` and `retryPull()`: reset the attempt counters and re-send.
- `setDelayBlocks(uint256)`: for the race experiment.
- `halt()`: manual stop for cross-chain fronting. Used in emergencies, and to isolate the Morpho path during the race.
- `resume()`: clears `halted`.
- `closeFill(fillId, stage)`: manual repair.

Every handled event emits `Handled(uint256 indexed traceId, uint8 kind, uint256 fillId)` on Lasna for the harness.

**Gas limits**

| Callback | Gas limit |
|---|---|
| `pullFromMorpho` | 1,500,000. **Measured: 748k** for a Morpho withdraw plus 25 payments to 25 distinct addresses (`test_pull_gasBounded_with100DistinctQueuedUsers`) |
| `front` | 1,500,000 (it also calls `vault.onFronted`, which settles the queue) |
| `reimburse` | 300,000 |

All are above the 100k minimum. Keep `react()` under the 900k cap. A Cron10 tick that loops over `openFills` must stay small, so cap open fills at 10.

**Payload rule:** `abi.encodeWithSignature("pullFromMorpho(address,uint256)", address(0), traceId)`. The first argument is always `address(0)`.

---

## 5. Flows

**A. Deposit settles the queue.** Same transaction, no Reactive, ~0s by design.
`deposit()` → `_settle()` → `WithdrawSettled`

**B. Morpho repayment settles the queue.** One reactive hop.
1. Borrower calls `Repay` on Morpho (Base). This is **t0**.
2. Lasna `react()` emits `Handled`. This is **t1**.
3. Base `pullFromMorpho` runs and emits `WithdrawSettled(traceId)`. This is **t2**.

**C. Cross-chain via credit.** One hop to the user's payout, then one more hop to reimburse the relayer.
1. `requestWithdraw` queues the withdrawal and emits `StateUpdated` with a shortfall. This is **t0**.
2. Lasna `react()` opens the fill and requests `front`. This is **t1**.
3. Base `front` sends the funds, the vault settles the queue, and `Fronted` and `WithdrawSettled` are emitted. This is **t2**, and **the user is paid here**.
4. Lasna sees `Fronted` and requests `reimburse(sent)`. This is **t3**.
5. Unichain `Reimbursed` is emitted. This is **t4**, and the fill is `DONE`.

**D. Credit refresh.** No callback.
Unichain `deposit` + `commitCredit` emits `CreditCommitted`, and Lasna updates its cache.

**E. Race round.** This is the experiment (§6.2).

---

## 6. Measurement

### 6.1 Latency

- **Trace:** `traceId = origin tx hash`. Every callback carries it, and `Handled`, `WithdrawSettled`, `Fronted` and `Reimbursed` all emit it.
- **Harness** (TypeScript + viem), for each loop:
  1. Send the origin tx and record wall-clock milliseconds when its receipt arrives.
  2. Poll every 100–200ms for the matching events, recording wall-clock milliseconds and block timestamps on every chain.
- **Resolution caveat:** Base block timestamps only resolve to 1 second. Report both the on-chain timestamp deltas and the wall-clock deltas.
- **Report:** N ≥ 30 loops for flow B and for flow C (user payout, t0→t2), with median, p95, max, success rate and a per-hop breakdown.
- **Use provider RPC keys,** because public RPCs rate-limit this kind of polling.

### 6.2 Latency race (the "why Omni" evidence)

**Question:** when freed liquidity is contested, how much more of it does the queue capture at Omni speed than at legacy-like speed?

**Setup** (our isolated Morpho market):
- The **vault** and a **competitor** (a second lender run by a script) both have supply in the market.
- A **borrower** has driven utilization to 100%.
- The vault has a queued withdrawal of at least `X`.

**Each round:**
1. The borrower repays `X`.
2. The competitor bot sees the `Repay` and, after `C` seconds, tries to withdraw `X`.
3. Sluice tries to pull for the queue, either at native speed (`delayBlocks = 0`) or legacy-like speed (`delayBlocks = 6`, so ~1s + 6 Cron1 ticks ≈ 7s).
4. **Measure the capture rate:** the share of `X` that lands in the queue (`WithdrawSettled` traced to that repay ÷ `X`).

**Matrix:** Sluice speed {native, ~7s} × competitor delay `C` {2s, 4s, 6s}, with at least 10 rounds per cell (60 or more in total).

**Expected result** (to be verified, not claimed in advance): native speed captures most of `X` when the competitor is slower than about 2s. The ~7s mode captures little unless the competitor is slower than 7s. The headline chart is capture rate against competitor delay, one line per Sluice speed.

**Honesty notes for the README:**
- `delayBlocks = 6` *approximates* legacy speed by adding delay on Omni. It isn't a run on the legacy network.
- A same-block searcher (C ≈ 0) beats both speeds, and we say so.
- Cron1 is billed every tick, so it's subscribed only during delay-mode rounds.

---

## 7. Deployment order and funding

1. **Base:** deploy `MockUSD`, `MockCollateral`, `FixedOracle`, then `morpho.createMarket(params)` → `marketId`.
2. **Unichain:** deploy `MockUSD`.
3. **Lasna:** deploy `SluiceReactive` and fund it with lREACT. Budget extra for Cron ticks during the race.
4. **Base:** deploy `SluiceVault(proxy, reactive, …)` and `RelayerReserve(proxy, reactive, …)`, then `vault.setReserve(reserve)`. Fund both through the Base proxy's `depositTo` with Base Sepolia ETH.
5. **Unichain:** deploy `SiblingVault(proxy, reactive, …)`, set `safetyBuffer`, and fund it through the Unichain proxy's `depositTo`.
6. **Lasna:** `reactive.configure(...)` subscribes to everything. Then `resync(...)` with the initial values.
7. **Seed:**
   - Vault deposits are allocated to Morpho.
   - The competitor supplies to the market.
   - The borrower posts collateral and borrows to 100% utilization.
   - The relayer funds the reserve.
   - The sibling receives a deposit and calls `commitCredit()`.

Getting a `callbackSender` wrong can't be fixed, because it's immutable. You'd have to redeploy.

---

## 8. Invariants (my test suite checks these)

- **FIFO:** no request is paid while an earlier one has a remainder. Partial fills happen only at the head.
- **Conservation:** sum paid + `pendingTotal` == sum queued.
- **Reservation:** while `pendingTotal > 0`, nothing is paid instantly and idle assets only go to the queue.
- **Auth:** callbacks revert for non-proxy callers and for the wrong `rvm`. `onFronted` only accepts the reserve.
- **Idempotency with re-emit:** a repeated `fillId` changes no balances and re-emits the stored result, on both `front` and `reimburse`.
- **Reimburse matches what was sent:** a reimbursement never exceeds what the reserve actually sent for that fill, and never happens for an unfronted fill.
- **Safety buffer:** `creditAvailable <= balance - safetyBuffer` at commit time, and sibling withdrawals never touch credit.
- **Bad-debt halt:** a `Liquidate` with bad debt in our market stops all new fronts until `resume()`.
- **Healing:** with a `Fronted` or `Reimbursed` event dropped, retries reach `DONE` and caches recover from the next absolute event.
- **Retry cap:** no more than 3 retries per pull or fill, with backoff, and Cron10 off when idle.
- **No-op safety:** a pull with zero liquidity doesn't revert and still emits `StateUpdated`.
- **Gas bound:** `_settle` with 100 queued requests stays under the callback gas limit.
- **Fork test (Base Sepolia):** create the market, borrow to 100%, repay → `morphoWithdrawable` rises. Also check the `Liquidate` data layout.
- **Full cycle:** `reactive-test-lib` (`omni` branch) over flows B and C, including dropped-event scenarios.

---

## 9. Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Callback contract in debt | Callbacks stop silently | Fund with margin. The dashboard shows proxy reserves and debt. |
| Reactive contract in debt | Nothing reacts; events during debt may be lost | `depositTo` with margin (Cron costs included), `coverDebt()`, then `resync` |
| Callback gas too low | `CallbackFailure`, still billed | Gas limits measured in tests. Retries are capped at 3, so it can't drain funds. |
| Front fails | Fill stays `FRONTING` | Retry tick re-sends (idempotent). No reimbursement is ever sent for it. |
| Reimburse fails (no credit) | Relayer not yet paid | `ReimburseFailed` keeps it retryable. `GaveUp` after 3 tries, then `retryFill` once credit is committed |
| Confirmation event missed | Fill looks open | Retry re-sends, and the destination re-emits the stored result, which heals it |
| Stale caches | Wrong decisions | Every event carries absolute values that overwrite the cache, plus owner `resync` |
| Bad debt in our market | Spreading losses across chains | `halted = true` on the `Liquidate` event, so fronting stops until reviewed |
| Someone grabs Morpho liquidity in the same block | Partial or zero pull | The queue stays, and the next liquidity event retries. Measured in the race. |
| Cron billing | Steady lREACT drain | Cron1 only in delay mode, Cron10 only while something is in flight |

---

## 10. Limitations and claims we don't make (copy into the README)

- **It can't create liquidity.** If every chain is drained, the queue waits.
- **A same-block searcher beats Sluice** to freed Morpho liquidity. Inside the vault, the reservation rule guarantees order.
- **Cross-chain uses a pre-funded relayer reserve and pre-committed credit,** not a bridge. Both are capital set aside in advance. **We don't claim Sluice reduces idle capital.**
- **The ~7s comparison is simulated** by adding delay on Omni, not run on the legacy network.
- **`irm = address(0)`** means the demo market has no interest. Shares are 1:1, and the vault isn't full ERC-7540.
- **The demo actors** (borrower, competitor, relayer) are our own scripts against a real Morpho deployment.

---

## 11. Verification status

- [x] Borrowing works with `irm = address(0)`, the oracle price scale is right, and the full borrow → 100% utilization → repay cycle works. All of it runs in tests against **Morpho Blue's real bytecode**, captured from Base Sepolia into `test/fixtures/`.
- [x] `Liquidate` data layout: checked against `EventsLib.sol` in `morpho-blue@v1.0.0`.
- [x] Callback gas: `pullFromMorpho` with 25 payments uses 748k of its 1.5M limit.
- [x] The full deploy (all 8 scripts) rehearsed on local forks of all three live chains: real Morpho, real callback proxies, real Lasna system contract.
- [ ] Logs from one origin tx reach `react()` in log order (on the live network). The design tolerates reordering.
- [ ] Whether events are delivered exactly once (on the live network). The design tolerates duplicates.
- [ ] The lREACT cost per Cron tick, to budget the race.
- [ ] The Lasna explorer URL format for transaction links.

Note: in `reactive-test-lib`, simulated Cron events carry the block number as an indexed topic (the docs say it's in `data`), and simulated events have `txHash = 0`. SluiceReactive reads neither field from Cron events, so both forms work.
