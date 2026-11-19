# Sluice: Step-by-Step Build Guide

This guide takes you from an empty computer to a submitted buildathon entry. It assumes no prior context. Each step says **what to do** and **what to check before moving on**. Don't skip the checks; most lost days come from building on a step that silently didn't work.

- Detailed contract specs: [ARCHITECTURE.md](ARCHITECTURE.md)
- Who does what, and the calendar: [PLAN.md](PLAN.md)

---

## What you're building, in 60 seconds

**The problem.** When a lending vault runs out of free cash, depositors who want to withdraw are stuck in a queue. Someone (a manager or a bot) has to notice when cash comes back and pay them, often hours later. Whoever runs the fastest bot grabs freed cash first.

**Sluice.** A vault on **Base Sepolia** (a test network) lends its money into a **Morpho Blue** lending market. When withdrawals can't be paid, they wait in a first-come, first-served queue. A **reactive contract** on **Reactive Network's Lasna testnet** watches for events that mean cash is available again:

- **A borrower repays in Morpho.** Sluice pulls the freed cash back and pays the queue.
- **Base is short but a sibling vault on Unichain Sepolia has spare cash.** A relayer reserve on Base pays the queue immediately, and the relayer is then reimbursed from the Unichain vault.

**The key terms:**

| Term | Meaning |
|---|---|
| Origin chain | Where an event happens (e.g. a repayment on Base Sepolia) |
| Reactive contract | A contract on Reactive Network that subscribes to events on other chains. Its `react()` function runs automatically when a matching event appears |
| Callback | A transaction the reactive contract asks Reactive Network to send to a contract on a destination chain |
| Callback proxy | The contract on each destination chain that delivers callbacks and charges for them |
| lREACT | Lasna testnet's token. It pays for reactive transactions |

**The evidence we'll show judges:**

- **Latency:** seconds from event to payout, measured over many loops.
- **The race:** how much freed cash the queue captures at Reactive Omni's ~1s speed against a simulated ~7s speed, when a competing bot also tries to grab it.

---

## Rules to keep in mind the whole time

- **Deadline:** Sat Dec 5, 2026, 20:00 UTC. **Aim to submit by Fri Dec 4.**
- Everything must be built during the event (Nov 5 – Dec 5). The repository must be **public and open-source** at submission.
- **Testnets only.** Never use a wallet that holds real money.
- **On Base Sepolia, use timestamps, never block counts, for any timer.** Base makes about 5 blocks per second, and they share the same timestamp.

---

## What to buy

**Nothing. Total cost is $0.** Everything below is free:

| Item | Free option | Paid upgrade (optional) |
|---|---|---|
| Code tools | Git, Foundry, Node.js, VS Code | None |
| Wallet | MetaMask browser extension | None |
| Test network ETH | Public faucets | None (never pay for testnet ETH; it has no value, and sellers are often scams) |
| RPC access (how your scripts talk to blockchains) | Free tier at Alchemy or QuickNode | Only if free-tier rate limits block your measurement runs |
| Screen recording for the demo video | OBS Studio | None |
| Dashboard hosting | Vercel free tier | None |

---

## Phase A: Tools, wallet and funds

### Step 1: Install the tools

**Do:**

1. **Git:** install from git-scm.com. On Windows this also gives you **Git Bash**. Use Git Bash for every command in this guide.
2. **Foundry** (Solidity compiler, tester and deployer). In Git Bash:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   # close and reopen the terminal, then:
   foundryup
   ```
3. **Node.js 22 LTS** from nodejs.org. It includes npm.
4. **VS Code** with a Solidity extension.

**Check before moving on:**
```bash
git --version      # any recent version
forge --version    # 1.5.x or newer
cast --version
node --version     # v22.x
npm --version
```
All five print a version. If `forge` isn't found, reopen the terminal and run `foundryup` again.

### Step 2: Create a testnet-only wallet

**Do:**
```bash
cast wallet new
```
This prints an **address** and a **private key**. Store the private key in a password manager. **Never use this wallet for real money, and never put its key in a file that gets committed.**

Import the private key into MetaMask (Account menu → Add account → Import account) so you can see balances in a browser.

**Check before moving on:**
```bash
cast wallet address --private-key <YOUR_PRIVATE_KEY>
```
This prints the same address as `cast wallet new` did.

### Step 3: Add the three networks to MetaMask, and turn off Smart Transactions

**Do:** in MetaMask, add these networks (Settings → Networks → Add network manually):

| Network | Chain ID | RPC URL | Currency | Explorer |
|---|---|---|---|---|
| Base Sepolia | 84532 | https://sepolia.base.org | ETH | https://sepolia.basescan.org |
| Unichain Sepolia | 1301 | https://sepolia.unichain.org | ETH | Unichain Sepolia explorer from Unichain's docs |
| Reactive Lasna | 5318007 | https://lasna-rpc.rnk.dev/ | lREACT | https://lasna.reactscan.net |

Then go to Settings → Advanced → **Smart Transactions → OFF**. Reactive's docs warn that this MetaMask feature silently drops transactions on Reactive Network.

**Check before moving on:** you can switch to each network and see a balance (0 is fine) without errors.

### Step 4: Get free RPC keys

Public RPCs are fine for deploying. For the measurement runs (many fast requests) you need your own endpoint, or you'll get rate-limited.

**Do:** sign up at Alchemy or QuickNode (free tier) and create endpoints for **Base Sepolia** and **Unichain Sepolia**. Lasna uses its public RPC.

**Check before moving on:**
```bash
cast chain-id --rpc-url <YOUR_BASE_SEPOLIA_URL>      # prints 84532
cast chain-id --rpc-url <YOUR_UNICHAIN_SEPOLIA_URL>  # prints 1301
cast chain-id --rpc-url https://lasna-rpc.rnk.dev/   # prints 5318007
```

### Step 5: Get testnet ETH

**Do:**
- **Base Sepolia ETH (target: at least 0.3).** Use the faucets listed at docs.base.org → Chain → Network Faucets. Most give small daily amounts, so start early and use several.
- **Unichain Sepolia ETH (target: at least 0.1).** Use a faucet listed in Unichain's docs, or bridge Ethereum Sepolia ETH through the official Unichain Sepolia bridge.
- **Ethereum Sepolia ETH (target: at least 0.3).** This is the easiest way to buy lREACT in Step 6.

These targets are estimates. You'll measure the real burn rate in Step 23.

**Check before moving on:**
```bash
cast balance <YOUR_ADDRESS> --rpc-url <YOUR_BASE_SEPOLIA_URL> --ether
cast balance <YOUR_ADDRESS> --rpc-url <YOUR_UNICHAIN_SEPOLIA_URL> --ether
```
Both are at or above the targets.

### Step 6: Get lREACT (Lasna gas)

The Reactive faucet is a contract: you send it Sepolia ETH and receive lREACT at **1 ETH → 100 lREACT**.

**Never send more than 5 ETH in one transaction; the excess is lost.**

**Do** (pick one chain):
```bash
# From Ethereum Sepolia
cast send 0x9b9BB25f1A81078C544C829c5EB7822d747Cf434 "request(address)" <YOUR_ADDRESS> \
  --value 0.3ether --rpc-url <ETH_SEPOLIA_RPC> --private-key <YOUR_PRIVATE_KEY>

# Or from Base Sepolia
cast send 0x2afaFD298b23b62760711756088F75B7409f5967 "request(address)" <YOUR_ADDRESS> \
  --value 0.3ether --rpc-url <YOUR_BASE_SEPOLIA_URL> --private-key <YOUR_PRIVATE_KEY>
```

**Check before moving on** (wait a few minutes):
```bash
cast balance <YOUR_ADDRESS> --rpc-url https://lasna-rpc.rnk.dev/ --ether
```
This should show **at least 20 lREACT**. If nothing arrives after 10 minutes, report it in Reactive's Telegram, as their docs advise.

---

## Phase B: Project setup

### Step 7: Get the project

**Do, if the repo already exists:**
```bash
git clone --recurse-submodules <REPO_URL> sluice
cd sluice
```

**Do, if you're starting from scratch** (this reproduces the current setup exactly):
```bash
mkdir sluice && cd sluice
git init -b main
forge init --force --empty .
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 \
  morpho-org/morpho-blue@v1.0.0 \
  Reactive-Network/reactive-lib-omni@v0.1.0 \
  Reactive-Network/system-smart-contracts@8f7b902700dc1a545d11b87bfb575ac06485224a \
  Reactive-Network/reactive-test-lib@omni
```

On Windows, the last install may end with `fatal: no submodule mapping found ... reactive-test-lib`. The library is still installed; only the bookkeeping failed. Fix it with:
```bash
git config -f .gitmodules submodule.lib/reactive-test-lib.branch omni
```

Then create `remappings.txt`:
```
reactive-test-lib/=lib/reactive-test-lib/src/
@reactive/src/=lib/reactive-lib-omni/src/
@system/=lib/system-smart-contracts/src/
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
morpho-blue/=lib/morpho-blue/src/
```

Then set these in `foundry.toml` under `[profile.default]`. They're required by the Reactive test library:
```toml
solc_version = "0.8.29"
evm_version = "cancun"
via_ir = true
optimizer = true
optimizer_runs = 200
fs_permissions = [{ access = "read-write", path = "./deployments" }]

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC}"
unichain_sepolia = "${UNICHAIN_SEPOLIA_RPC}"
lasna = "${LASNA_RPC}"
```

Finally, **delete the `docs/` line from `.gitignore`**. Foundry adds it by default, and it would keep the spec out of the repo.

**Check before moving on:** `ls lib` shows `forge-std`, `morpho-blue`, `openzeppelin-contracts`, `reactive-lib-omni`, `reactive-test-lib` and `system-smart-contracts`.

### Step 8: Configure secrets

**Do:**
```bash
cp .env.example .env
```
Edit `.env`: set `PRIVATE_KEY`, and replace the Base and Unichain RPC URLs with your Step 4 endpoints. Then load it into your shell. Run this in every new terminal:
```bash
set -a; source .env; set +a
```

**Check before moving on:**
```bash
cast chain-id --rpc-url $BASE_SEPOLIA_RPC       # 84532
cast chain-id --rpc-url $UNICHAIN_SEPOLIA_RPC   # 1301
cast chain-id --rpc-url $LASNA_RPC              # 5318007
git check-ignore .env && echo "OK: .env is ignored"
```
The last line must print `OK`. If it doesn't, **stop** and fix `.gitignore` before anything else.

### Step 9: Build and run the smoke test

**Do:**
```bash
forge build
forge test
```

**Check before moving on:** `2 passed; 0 failed`. The test `test_fullCycle_originToCallback` proves the libraries work together and that a full event → `react()` → callback cycle runs locally.

### Step 10: Re-verify the external facts

Addresses on testnets can change, so confirm them on the day you deploy.

**Do:**
1. Open dev.reactive.network → Origins & Destinations and compare the **callback proxy** addresses for Base Sepolia and Unichain Sepolia with your `.env`.
2. Confirm Morpho Blue is live on Base Sepolia, with what we need enabled:
   ```bash
   cast call $MORPHO "owner()(address)" --rpc-url $BASE_SEPOLIA_RPC
   cast call $MORPHO "isIrmEnabled(address)(bool)" 0x0000000000000000000000000000000000000000 --rpc-url $BASE_SEPOLIA_RPC
   cast call $MORPHO "isLltvEnabled(uint256)(bool)" 860000000000000000 --rpc-url $BASE_SEPOLIA_RPC
   ```

**Check before moving on:** the proxy addresses match, `owner()` returns an address, and both `isIrmEnabled` and `isLltvEnabled` return `true`. If anything differs, update `.env` and [ARCHITECTURE.md](ARCHITECTURE.md) §1 first.

---

## Phase C: First live loop (learn the Reactive cycle on something tiny)

### Step 11: Write the Ping contracts

**Do:** create `src/day1/Ping.sol`, copying the three `Ping*` contracts from `test/Toolchain.t.sol`, with two changes for live use:
- `PingReactive` gets a **`payable` constructor** (so it can be funded at deploy) and an **owner-only `setCallback(address)`** instead of an immutable destination.
- Keep `react(LogRecord calldata log_)` with the `onlySystem` modifier. **Never use `revert` or `require` inside `react()` to filter events**, because reverted calls are still billed.

**Check before moving on:** `forge build` passes.

### Step 12: Deploy and wire the Ping loop

**Order matters:**
- The callback contract stores the reactive contract's address permanently (it's immutable). So deploy the **reactive contract first**, then the callback, then tell the reactive contract where the callback is.
- **If you ever redeploy a reactive contract, you must redeploy every callback contract that trusts it.**

**Do:**
```bash
# 1. Origin on Base Sepolia
forge create --broadcast --rpc-url base_sepolia --private-key $PRIVATE_KEY src/day1/Ping.sol:PingOrigin
export ORIGIN=<deployed address>

# 2. Reactive on Lasna, funded with 1 lREACT; args: origin chain, origin address, destination chain
forge create --broadcast --rpc-url lasna --private-key $PRIVATE_KEY --value 1ether \
  src/day1/Ping.sol:PingReactive --constructor-args 84532 $ORIGIN 84532
export REACTIVE=<deployed address>

# 3. Callback on Base Sepolia; args: Base Sepolia callback proxy, reactive address
forge create --broadcast --rpc-url base_sepolia --private-key $PRIVATE_KEY \
  src/day1/Ping.sol:PingCallback --constructor-args $BASE_SEPOLIA_CALLBACK_PROXY $REACTIVE
export CALLBACK=<deployed address>

# 4. Fund the callback THROUGH THE PROXY (callbacks are paid in Base Sepolia ETH, not lREACT)
cast send $BASE_SEPOLIA_CALLBACK_PROXY "depositTo(address)" $CALLBACK --value 0.01ether \
  --rpc-url base_sepolia --private-key $PRIVATE_KEY

# 5. Wire up
cast send $REACTIVE "setCallback(address)" $CALLBACK --rpc-url lasna --private-key $PRIVATE_KEY
```

**Check before moving on:**
```bash
cast code $ORIGIN --rpc-url base_sepolia | head -c 10      # not "0x"
cast code $REACTIVE --rpc-url lasna | head -c 10           # not "0x"
cast code $CALLBACK --rpc-url base_sepolia | head -c 10    # not "0x"
cast call $SYSTEM_CONTRACT "debt(address)" $REACTIVE --rpc-url lasna | cast to-dec                           # 0
cast call $BASE_SEPOLIA_CALLBACK_PROXY "reserves(address)" $CALLBACK --rpc-url base_sepolia | cast to-dec  # > 0
```

### Step 13: Fire the loop and verify all three hops

**Do:**
```bash
cast send $ORIGIN "ping(uint256)" 1 --rpc-url base_sepolia --private-key $PRIVATE_KEY
```

**Check before moving on:**
1. **The reactive transaction exists.** Open `https://lasna.reactscan.net`, search for `$REACTIVE`, and find a new transaction from a few seconds ago. Copy its hash.
2. **The callback was delivered without error:**
   ```bash
   cast call $SYSTEM_CONTRACT "getCallbacks(uint256)((uint256,address,uint256,uint256,uint256,bytes)[])" \
     <REACTIVE_TX_HASH> --rpc-url lasna
   ```
   The record includes a destination tx hash, and the last field (error) is empty. An empty array just means "not recorded yet", so wait and retry.
3. **The callback ran.** On sepolia.basescan.org, the callback contract shows a transaction emitting `Pong(1, <traceId>)`.
4. **Write all three hashes in `notes/loops.md`.**

**If the callback never arrives**, check these in order (from Reactive's debugging guide):
- Callback gas limit below 100,000. Such requests are silently ignored.
- The callback contract is in debt or unfunded. Fund it through the proxy with `depositTo`.
- Wrong proxy address passed to the callback constructor.
- Wrong reactive address passed to the callback constructor. This can't be changed; redeploy.
- The payload's first argument isn't an `address` placeholder (`address(0)`).

---

## Phase D: Test tokens and the Morpho market

### Step 14: Write the mock tokens and oracle

**Do:** in `src/mocks/`:
- `MockUSD`: ERC20, **6 decimals**, `mint(address,uint256)` open to anyone.
- `MockCollateral`: ERC20, **18 decimals**, open mint.
- `FixedOracle`: `price()` returns **`1e24`** (1 collateral = 1 MockUSD, at Morpho's 1e36 price scale adjusted for 18 vs 6 decimals).

**Check before moving on:** unit tests show the decimals, that minting works, and that `price()` returns `1e24`.

### Step 15: Prove the market works in a fork test (before spending real testnet gas)

A fork test runs against a copy of live Base Sepolia on your machine.

**Do:** write `test/fork/MorphoMarket.t.sol`:
1. Deploy the mocks and create a market: `{loanToken: MockUSD, collateralToken: MockCollateral, oracle: FixedOracle, irm: address(0), lltv: 0.86e18}`.
2. A lender supplies 1,000 MockUSD.
3. A borrower posts collateral and borrows **all 1,000** (100% utilization).
4. The lender tries to withdraw and gets nothing.
5. The borrower repays 400, and now the lender can withdraw 400.
6. Also force a liquidation that creates bad debt, and decode the `Liquidate` event's data to confirm where `badDebtAssets` sits.

Run it:
```bash
forge test --match-path "test/fork/*" --fork-url $BASE_SEPOLIA_RPC -vv
```

**Check before moving on:** all of it passes. This confirms three assumptions the whole design depends on:
- Borrowing works with `irm = address(0)`.
- The oracle scale is correct.
- The `Liquidate` data layout is as expected.

Tick these in [ARCHITECTURE.md](ARCHITECTURE.md) §11.

### Step 16: Deploy the mocks and create the market live

**Do:** with a forge script, deploy `MockUSD`, `MockCollateral` and `FixedOracle` on Base Sepolia, plus `MockUSD` on Unichain Sepolia. Then call `morpho.createMarket(params)`. Save every address and the `marketId` to `deployments/base-sepolia.json` and `deployments/unichain-sepolia.json`.

**Check before moving on:**
```bash
cast call $MORPHO "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" $MARKET_ID --rpc-url base_sepolia
```
The 5th value (`lastUpdate`) is non-zero, which means the market exists.

### Step 17: Create a crunch live

**Do:** with a script:
1. Mint MockUSD to a lender wallet and supply it to the market.
2. Mint collateral to a borrower wallet, post it, and borrow everything.

**Check before moving on:** in the `market(...)` output, value 1 (`totalSupplyAssets`) equals value 3 (`totalBorrowAssets`). The market is at 100% utilization.

---

## Phase E: The vault

### Step 18: Write the interfaces first

**Do:** create `src/interfaces/` with every event and function signature from [ARCHITECTURE.md](ARCHITECTURE.md) §4. That covers `ISluiceVault`, `IRelayerReserve`, `ISiblingVault` and `ISluiceReactive`'s events.

**Check before moving on:** `forge build` passes, and the events match the spec exactly (names, argument order, which ones are `indexed`). The reactive contract will subscribe by these exact signatures.

### Step 19: Build `SluiceVault`

**Do:** implement [ARCHITECTURE.md](ARCHITECTURE.md) §4.2:
- **`deposit`** pays the queue in the same transaction.
- **`requestWithdraw`** pays instantly only if the queue is empty and there's enough liquidity; otherwise it queues the request.
- **The queue** is FIFO with partial fills, at most 25 payments per call.
- **The reservation rule:** while anyone is waiting, nothing else leaves the vault.
- **`pullFromMorpho`** is a callback guarded by `onlyServiceProvider` and `onlyCallbackSender`. It never reverts when there's nothing to do, and it **always** emits `StateUpdated`.

**Check before moving on:** these tests pass:
- **FIFO:** nobody is paid while someone earlier is still owed.
- **Conservation:** total paid + still pending = total queued.
- **Reservation:** while the queue is non-empty, new requests always queue.
- **Auth:** a random caller and a wrong reactive address are both rejected.
- **No-op:** a pull with zero liquidity doesn't revert and still emits `StateUpdated`.
- **Gas:** `forge test --gas-report` shows `pullFromMorpho` with 25 payments **well under 1,500,000 gas**. If it's close, lower the per-call payment cap.

---

## Phase F: The reactive contract and the first real loop (the Execution gate)

### Step 20: Build `SluiceReactive` v1

**Do:** implement [ARCHITECTURE.md](ARCHITECTURE.md) §4.5, subscriptions 1–4 only:
- React to the vault's `StateUpdated` and to Morpho's `Repay` / `Supply` / `Liquidate` **filtered to your market id**, and request `pullFromMorpho`.
- **Halt** when a `Liquidate` reports bad debt.
- **Delay mode:** when `delayBlocks > 0`, wait using Cron1 ticks before pulling.
- **Retries:** Cron10 ticks, backoff, at most 3 attempts. Subscribe to Cron only while needed, because every tick is billed.
- Owner `resync`, a public `coverDebt()`, and a `Handled(traceId, …)` event for every handled event.
- **Every callback payload starts with `address(0)`.** Every callback gas limit is **at least 100,000**.

**Check before moving on:** `reactive-test-lib` full-cycle tests (see `test/Toolchain.t.sol` for the pattern) pass for:
- A repay that pays the queue.
- A dropped `StateUpdated` that recovers through retry.
- Delay mode waiting the right number of ticks.
- The retry cap stopping at 3.
- Bad debt halting.

### Step 21: Deploy v1 live

**Do, in this order:**
1. Deploy `SluiceReactive` on Lasna, funded with 5 lREACT.
2. Deploy `SluiceVault` on Base Sepolia, passing the **Base callback proxy** and the **reactive address**.
3. Fund the vault through the proxy: `depositTo(vault)` with 0.05 ETH.
4. Call `configure(...)` on the reactive contract, then `resync(...)` with the current values.

Save all addresses to `deployments/`.

**Check before moving on:**
- Every address has code.
- Reactive `debt` is 0, and the vault's proxy `reserves` are above 0.
- **Test that the subscriptions work:** make a small deposit into the vault. A `Handled` event should appear on Lasna within a few seconds.

### Step 22: Run the first full Sluice loop

**Do:**
1. Deposit MockUSD into the vault and let it be supplied to Morpho.
2. Have the borrower borrow everything (100% utilization).
3. A user calls `requestWithdraw`, which queues because there's no liquidity.
4. The borrower **repays** on Morpho.

**Check before moving on:**
- Within seconds, the vault emits `WithdrawSettled` with **`traceId` equal to the repay transaction's hash**.
- Find the Lasna `Handled` event with the same `traceId`.
- Record all three hashes in `notes/loops.md`.

**🎉 This is the Execution gate.** From here you always have a valid entry.

### Step 23: Measure your burn rate and back up the code

**Do:**
1. Note lREACT and ETH balances before and after 5 loops, and estimate how much you'll need for about 150 more loops (measurement runs plus the race). Top up now if needed (Steps 5–6).
2. Create a **public** GitHub repository and push to it:
   ```bash
   git add -A
   git commit -m "Sluice v1: vault + reactive Morpho path, first live loop"
   git remote add origin <YOUR_GITHUB_REPO_URL>
   git push -u origin main
   ```

**Check before moving on:**
- `git ls-files | grep -i "\.env"` shows **only** `.env.example`.
- The repo opens on GitHub in a private/incognito browser window.

---

## Phase G: The latency race (the "why Omni" evidence)

### Step 24: Build the measurement harness

**Do:** in `harness/`, create a TypeScript project with viem:
```bash
mkdir harness && cd harness && npm init -y
npm install viem dotenv
npm install -D typescript tsx @types/node
```
For each loop, the harness:
1. Sends the origin transaction and records **wall-clock milliseconds** when its receipt arrives.
2. Polls every 100–200ms for the matching `Handled` (Lasna) and `WithdrawSettled` (Base) events by `traceId`, recording wall-clock milliseconds and block timestamps for each.
3. Writes one JSON record per loop to `results/`.

**Check before moving on:** a single traced loop prints three hops with timings, and the results file contains them.

### Step 25: Build the race bots

**Do:**
- **Borrower bot:** repays `X` on command.
- **Competitor bot:** a second lender in the same market. When it sees a `Repay`, it waits `C` seconds and then tries to withdraw `X`.

**Check before moving on:** run one round by hand. Afterwards, the amount the queue received plus the amount the competitor received equals `X`.

### Step 26: Run the first race matrix and make the go/adjust decision

**Do:** run at least 5 rounds for each combination:
- Sluice speed: native (`delayBlocks = 0`) or slowed (`delayBlocks = 6`, about 7s).
- Competitor delay `C`: 2s, 4s or 6s.

Switch speed with `setDelayBlocks` on the reactive contract.

**Check before moving on:** you have a capture-rate table (share of `X` paid to the queue, per combination). Then decide:
- **Native clearly beats slowed:** this is your headline chart, so continue.
- **No meaningful difference:** still continue, since the loop works. Lead the pitch with fairness and "no operator", and treat Phase H as optional.

---

## Phase H: Cross-chain (cut this first if you're behind)

> **Deadline for this phase: Sat Nov 28, evening.** If it isn't live by then, skip to Phase I and document cross-chain as a design with passing local tests.

### Step 27: Build `RelayerReserve` (Base) and `SiblingVault` (Unichain)

**Do:** implement [ARCHITECTURE.md](ARCHITECTURE.md) §4.3–4.4:
- `front` and `reimburse` are **idempotent**: repeating a fill id changes nothing and **re-emits** the stored result.
- The Unichain vault only offers surplus **above its safety buffer**.
- `reimburse` without enough credit emits `ReimburseFailed` and does **not** revert.

**Check before moving on:** tests for idempotency with re-emit, the safety buffer, and no revert on insufficient credit all pass.

### Step 28: Upgrade the reactive contract to v2

**Do:**
- Add subscriptions 5–9 and per-fill stages.
- **Request `reimburse` only after seeing `Fronted`, and only for the amount actually sent.**
- Reserve credit for every open fill (`creditReserved()`).
- Add fill retries, plus `retryFill` and `closeFill`.

**Check before moving on:** full-cycle tests pass for:
- Flow C end to end.
- A reimbursement never exceeding what was sent.
- No reimbursement for a failed front.
- A dropped `Fronted` or `Reimbursed` healing through retry.
- No fronting while halted.

### Step 29: Deploy v2 live

**Remember:** a new reactive contract means **redeploying every callback contract** (vault, reserve, sibling), because each one permanently stores the reactive address it trusts. Then re-seed the market and balances.

**Do:**
1. Deploy in order: reactive (Lasna) → vault and reserve (Base) → sibling (Unichain).
2. Fund each callback contract through its own chain's proxy.
3. Call `configure` and `resync`.
4. The relayer funds the reserve. The sibling gets a deposit, its safety buffer is set, and it calls `commitCredit()`.

**Check before moving on:** run one flow C loop:
1. A withdrawal queues on Base with a shortfall.
2. `Fronted` and `WithdrawSettled` appear on Base. **The user is paid.**
3. A few seconds later, `Reimbursed` appears on Unichain with the **same amount** as `Fronted.sent`.

Record all hashes.

---

## Phase I: Full measurement runs

### Step 30: Run the final numbers

**Do:**
- At least **30 loops** of flow B (repay → paid).
- At least 30 loops of flow C, if it shipped.
- The race matrix at **at least 10 rounds per combination**.

**Check before moving on:**
- A summary shows median, p95, max and success rate per flow, and capture rate per race combination.
- A success rate below about 90% means something is wrong. Investigate before moving on (usually funding, gas limits or RPC rate limits).

---

## Phase J: Dashboard

### Step 31: Build the dashboard

**Do:**
```bash
npx create-next-app@latest dashboard --typescript
cd dashboard && npm install wagmi viem @tanstack/react-query
```
Show:
1. The **race chart** (capture rate against competitor delay, native vs slowed).
2. The queue (pending, shortfall, requests).
3. A live event feed across the three chains, with explorer links for every hop.
4. Per-loop latency.
5. Callback contract reserves and debt.

Deploy it on Vercel's free tier.

**Check before moving on:** while the dashboard is open, run a live loop and watch it appear within a few seconds. The public URL works in an incognito window.

> **Deadline: Tue Dec 1, evening.** If the full dashboard isn't working, ship a single page with the race chart and the latest loop.

---

## Phase K: Polish and submit

### Step 32: Harden

**Do:**
- Top up every contract's funding.
- Optional: a script that tries to jump the queue and visibly fails.
- Rerun a fresh set of loops so the submitted numbers are current.

**Check before moving on:** reactive `debt` is 0 and every callback contract has reserves for at least a day of loops.

### Step 33: Write the README

**Do:** cover:
- A one-line pitch, the problem, and how it works (with a diagram).
- **The race chart.**
- Latency results and the measurement method, including that the ~7s run is simulated by adding delay on Omni.
- Deployed addresses (on Lasna, Base Sepolia, Unichain Sepolia) and transaction hashes for every flow.
- How to run it.
- **Limitations and claims we don't make** (copy from [ARCHITECTURE.md](ARCHITECTURE.md) §10).

**Check before moving on:** clone the repo into a **new folder** and follow only the README. If `forge build` and `forge test` don't work from that fresh clone, fix the README.

### Step 34: Record the demo video (under 3 minutes)

**Do:** use OBS and follow the outline in [PLAN.md](PLAN.md):
- The problem.
- How it works.
- A live repay → paid loop.
- **The race chart.**
- Cross-chain, if shipped.
- Limitations.

Upload it to YouTube as unlisted.

**Check before moving on:**
- It runs **under 3:00**.
- Explorer pages are visible for at least one full loop.
- The link plays in an incognito window.

### Step 35: Submit on DoraHacks

**Do:** at dorahacks.io/hackathon/reactive-omni-buildathon, submit a build in the **Every Second Counts** track with:
- The public repo link and the video link.
- **Deployed addresses, and which network** (Lasna).
- **Transaction hashes for the full loop,** origin → reactive → callback, for each flow.
- **The latency measured and how** (traceId tracing, wall-clock milliseconds plus block timestamps, number of loops) and the race results.
- Optional questions: whether this was your first time with Reactive, the hardest part (from `notes/loops.md`), and how you heard about the buildathon.

**Check before moving on:**
- Submit by **Fri Dec 4**. The hard deadline is Sat Dec 5, 20:00 UTC.
- After submitting, open the build page while logged out and confirm every link works.

---

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| No reactive transaction after an origin event | Reactive contract in debt or unfunded, or subscription criteria wrong | Check `debt(address)` on the system contract, then `depositTo`. Recheck the chain ID, contract address and topic0 (`cast sig-event`). |
| Reactive tx exists, but no callback | Callback gas limit below 100,000 (silently ignored) | Raise the gas limit in the reactive contract |
| `getCallbacks` shows an error | The callback reverted, ran out of gas, or failed auth | Wrong proxy or reactive address in the callback constructor means redeploying. Otherwise raise the gas limit or fix the revert. |
| Callbacks stopped after working | The callback contract ran out of funds (debt) | `depositTo` on that chain's callback proxy |
| First argument of the callback is wrong | The payload is missing the `address(0)` placeholder | Make the first argument `address(0)`. The network overwrites it with the reactive address. |
| `Replacement transaction underpriced` | A stuck pending transaction | Resend with the same nonce and a higher gas price (see Reactive's debugging docs) |
| MetaMask transaction "interrupted" on Lasna | Smart Transactions is on | Settings → Advanced → Smart Transactions **off** |
| lREACT never arrived from the faucet | Faucet delay, or you sent more than 5 ETH (excess lost) | Wait, then report in Reactive's Telegram. Never send more than 5 ETH at once. |
| Timers misbehave on Base Sepolia | Counting blocks (Base makes ~5 per second) | Use timestamps |
| Lasna balance drains steadily | Cron subscriptions left on (billed every tick) | Unsubscribe when idle. The design only subscribes while something is pending. |
