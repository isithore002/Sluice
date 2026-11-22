# Sluice: Build and Run Guide

Written from what actually worked, including the problems hit along the way. It takes you from an empty machine to a live deployment with measured results. Each step says what to do and what to check before moving on.

- What the system is and why it's built this way: [README.md](../README.md)
- Contract-level spec: [ARCHITECTURE.md](ARCHITECTURE.md)
- Submission material: [SUBMISSION.md](SUBMISSION.md)

**Cost: $0.** Everything runs on testnets, and every tool and faucet used is free. Never pay for testnet tokens.

---

## What you need (measured, not estimated)

| Item | Amount | Notes |
|---|---|---|
| Base Sepolia ETH | about 0.2 | Gas is negligible (about 0.0002 ETH for the whole project). 0.02 funds callbacks. The rest is swapped for lREACT |
| Unichain Sepolia ETH | about 0.03 | 0.01 funds the sibling vault's callbacks. The rest is gas |
| Reactive Lasna lREACT | about 20 | This is the real budget. See below |

**lREACT is what you actually spend.** Each reactive transaction costs about 0.02 lREACT. Measured on the live runs:

| Activity | lREACT used |
|---|---|
| Flow B loop | about 0.08 |
| Flow C loop | about 0.14 |
| Race round | about 0.10 (more in the legacy-like mode, which pays for Cron ticks) |
| Full measurement set (33 B loops, 32 C loops, 60 race rounds) | about 14 |

Fund the reactive contract with 5 at deploy, then top it up as needed (step 14). **A contract in debt stops receiving events.**

---

## Phase A: Tools, wallet, funds

### 1. Install tools

- **Git** (on Windows this includes Git Bash; use it for every command below)
- **Foundry:** `curl -L https://foundry.paradigm.xyz | bash`, reopen the terminal, then `foundryup`
- **Node.js 22**

**Check:** `git --version`, `forge --version` (1.5.x), `node --version` (v22.x) all print versions.

### 2. Make a testnet-only wallet

```bash
cast wallet new
```

Save the private key in a password manager. **Use a wallet that holds only test tokens**, because the key goes into a local file. Import it into MetaMask to see balances.

**Check:** `cast wallet address --private-key <KEY>` prints the same address.

### 3. Add the networks to MetaMask

| Network | Chain ID | RPC | Currency | Explorer |
|---|---|---|---|---|
| Base Sepolia | 84532 | https://sepolia.base.org | ETH | https://sepolia.basescan.org |
| Unichain Sepolia | 1301 | https://sepolia.unichain.org | ETH | https://sepolia.uniscan.xyz |
| Reactive Lasna | 5318007 | https://lasna-rpc.rnk.dev/ | lREACT | https://lasna.reactscan.net |

If your MetaMask has a **Smart transactions** toggle (Settings → Transactions, or Advanced in older versions), turn it **off**. Reactive's docs warn it can silently drop their transactions.

### 4. Get Base Sepolia and Unichain Sepolia ETH

- Base Sepolia: [Alchemy faucet](https://www.alchemy.com/faucets/base-sepolia), [Chainlink faucet](https://faucets.chain.link/base-sepolia), others on [Base's list](https://docs.base.org/chain/network-faucets)
- Unichain Sepolia: [QuickNode faucet](https://faucet.quicknode.com/unichain/sepolia), [Alchemy faucet](https://www.alchemy.com/faucets/unichain-sepolia), others on [Unichain's list](https://docs.unichain.org/docs/tools/faucets)

**Check:** balances of at least 0.2 ETH on Base Sepolia and 0.03 ETH on Unichain Sepolia.

### 5. Get lREACT

Reactive's faucet is a contract: send it Base Sepolia ETH and it credits the same address on Lasna at **1 ETH = 100 lREACT**. **Never send more than 5 ETH in one transaction; the excess is lost.**

```bash
cast send 0x2afaFD298b23b62760711756088F75B7409f5967 "request(address)" <YOUR_ADDRESS> \
  --value 0.1ether --rpc-url https://sepolia.base.org --private-key <KEY>
```

Or send the ETH from MetaMask to that address. It arrived within seconds in our runs.

**Check:** `cast balance <YOUR_ADDRESS> --rpc-url https://lasna-rpc.rnk.dev/ --ether` shows about 10. Repeat for more.

---

## Phase B: Project setup

### 6. Clone and build

```bash
git clone --recurse-submodules https://github.com/isithore002/Sluice.git
cd Sluice
forge build
forge test
```

**Check:** `67 tests passed, 0 failed`. The tests run Morpho Blue's real bytecode and the real Omni system contracts, so they need no network.

If you rebuild the project from scratch instead of cloning, note: on Windows, `forge install Reactive-Network/reactive-test-lib@omni` finishes the install but errors on registering the branch (`no submodule mapping found`). Fix with `git config -f .gitmodules submodule.lib/reactive-test-lib.branch omni`. The pinned versions are in [`foundry.lock`](../foundry.lock) and the required compiler settings (solc 0.8.29, `cancun`, `via_ir`) in [`foundry.toml`](../foundry.toml).

### 7. Configure secrets

```bash
cp .env.example .env
```

Set `PRIVATE_KEY=0x...` in `.env`. Optionally replace `BASE_SEPOLIA_RPC` and `UNICHAIN_SEPOLIA_RPC` with provider URLs (Alchemy, QuickNode); public RPCs worked for everything here.

**Check:** `git check-ignore .env` prints `.env`. If it prints nothing, **stop**: `.env` could be committed. Never put the key anywhere but `.env`.

---

## Phase C: Deploy

### 8. Deploy everything

```bash
bash scripts/deploy.sh
```

Eight steps, in the order Reactive's docs require (the reactive contract first, because every callback contract stores its address permanently):

1. Base Sepolia: mock tokens, fixed oracle, **our Morpho market** (created on the real Morpho Blue deployment)
2. Unichain Sepolia: MockUSD
3. Lasna: `SluiceReactive`, funded with 5 lREACT
4. Base Sepolia: `SluiceVault` and `RelayerReserve`, each funded with 0.01 ETH on the callback proxy
5. Unichain Sepolia: `SiblingVault`, funded with 0.01 ETH on its callback proxy
6. Lasna: `configure`, which subscribes to the vault, Morpho (our market only), the reserve and the sibling
7. Base Sepolia: seed (vault deposit, a competitor lender, reserve inventory, then borrow to 100% utilization)
8. Unichain Sepolia: seed the sibling vault and commit credit

Pass a step number to resume: `bash scripts/deploy.sh 4`.

**Check:** every step prints `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`, and `deployments/*.json` hold the addresses.

### 9. Check the state

```bash
cd harness && npm install && npm run status
```

**Check:**
- Morpho market is **100% utilized**
- Queue pending is 0
- Reserve inventory and sibling credit are non-zero
- The **reactive contract's caches match** (inventory and credit populated). This proves its cross-chain subscriptions work, because it learned those values from events on Base and Unichain by itself
- All funding lines show **no debt**

### 10. Verify the source (optional, recommended)

```bash
forge verify-contract --verifier sourcify --chain-id 5318007 \
  --constructor-args $(cast abi-encode "constructor(uint256,uint256)" 84532 1301) \
  <SluiceReactive address> src/SluiceReactive.sol:SluiceReactive
```

Do the same for the others with their constructor arguments. **Check:** the Sourcify job reports `exact_match`.

---

## Phase D: Measure

All commands run in `harness/`. **Don't send other transactions from the same wallet while a run is going**, or nonces collide.

### 11. First live loop

```bash
npx tsx src/flowB.ts --n 3 --x 10
```

Each loop queues a withdrawal, a borrower repays in Morpho, Reactive reacts, and the vault pays the queue.

**Check:** 3/3 succeed. Open the printed transaction links: only the repayment is sent by your wallet. The callback on Base is sent by **Reactive's signer**, which proves no bot of yours is in the loop.

### 12. Flow B, 30 loops

```bash
npx tsx src/flowB.ts --n 30 --x 10
```

**Check:** about 30/30 succeed; median around 1.5 s.

### 13. The latency race

```bash
npx tsx src/race.ts --rounds 6 --delays 0,1,2,4,8 --speeds 0,6
```

Runs 60 rounds (about 25 minutes). A competitor bot tries to grab freed liquidity after each delay, with Sluice at native speed (`delayBlocks = 0`) and at a simulated legacy-like speed (`delayBlocks = 6`).

**Check:** no failed rounds, and in every round the queue's payout plus the competitor's equals the repaid amount.

### 14. Top up lREACT when needed

The reactive contract's reserves drain as it reacts. Check `npm run status`; top up before it hits zero:

```bash
cast send 0x8888888888888888888888888888888888888888 "depositTo(address)" <SluiceReactive> \
  --value 3ether --priority-gas-price 1gwei --rpc-url https://lasna-rpc.rnk.dev/ --private-key <KEY>
```

`depositTo` is the reliable route: it settles any debt first, then credits reserves. Sending funds straight to a contract in debt can strand them.

### 15. Flow C (cross-chain)

```bash
npx tsx src/flowC.ts --n 30 --x 10
```

**Check:** about 30/30 succeed. Median payout to the user around 1.4 s; the relayer is reimbursed on Unichain a few seconds later.

### 15b. Independent actors and the outsider demo

The loops above reuse one wallet for several roles. To show Sluice doesn't depend on that:

```bash
npm run independent -- --n 5 --x 10     # separate fresh wallets: Alice queues, Bob repays on behalf of the borrower
npm run arm -- --x 10 --slots 10        # queues ten withdrawals, so ten outsiders can each settle one
```

`npm run arm` is also what you run before recording the demo or leaving the project for judges. Then run the README's three "Try it yourself" commands from a **fresh wallet** to confirm they work: that is how the outsider test in `results/outsider-tryit.json` was made. **Check:** the settlement transaction is sent by Reactive's signer, and your fresh wallet sent exactly three transactions.

The dashboard's *Quick repay* panel lets a visitor do the same from their own wallet in one transaction. It is a shortcut: it calls the `OneClickRepay` helper (demo scaffolding, not part of Sluice), deployed once with `scripts/deploy.sh 9` (it writes `deployments/base-tryit.json`; rebuild the dashboard afterwards). Its *Connect wallet* button opens RainbowKit's wallet list (MetaMask, Phantom, Coinbase Wallet, Rabby and any other installed wallet) and switches the wallet to Base Sepolia, adding the network to MetaMask if needed. Phantom offers Base Sepolia only with Testnet Mode on (Settings → Developer Settings → Testnet Mode); the panel says so if the switch fails.

Each settlement costs the reactive contract about 0.08 lREACT, so keep it funded while judges may try it.

### 15b-2. The live Lender/Borrower demo

The dashboard's **Live demo** section (`#demo`) runs the whole product with two separate wallets. **Lender:** mint demo mUSD (open mint) → approve → deposit into the Sluice vault → request a withdrawal. **Borrower:** mint demo collateral → approve → supply collateral → borrow the pool's free cash straight on Morpho → repay on Morpho. Nobody calls Sluice to settle: Reactive sees the Morpho `Repay` and Reactive's signer pays the lender's ticket. Every button is a real transaction; tokens are open-mint mocks and the market and its price feed are ours.

The start state matters: the queue must be empty (a lender's deposit pays earlier tickets first), cross-chain fronting paused, and the Morpho market fully borrowed by our demo borrower. `npm run stage` (in `harness/`) sets that up and is safe to rerun. The two modes are opposites, so pick one per session:

```shell
npm run stage                          # live Lender/Borrower demo: empty queue, market 100% borrowed
npm run arm -- --x 10 --slots 10       # Quick repay shortcut: ten queued withdrawals, one per click
```

**Check:** after `npm run stage`, the dashboard shows 0 pending and 100% utilized. Running the lender's deposit and withdrawal request, then the borrower's borrow and repay with two wallets, ends with the lender's ticket paid by a callback sent by Reactive's signer.

### 15c. Batch continuation, the replay data and the case study

```bash
npm run batch -- --n 40 --each 1   # 40 wallets queue, then ONE repayment pays them all across 2 callbacks
npm run replay                     # results/replay-race.json: each race round plus the Lasna transaction that reacted to it
npm run casestudy                  # results/case-study-flowC.json: rebuilds the explanation of a failed cross-chain loop from chain data
npm run arm -- --x 10 --slots 10   # the batch run pays the armed withdrawals: re-arm afterwards
```

**Check:** `batch` ends with `OK: 40 withdrawals, 2 callbacks, FIFO verified, all lenders paid in full`. It is resumable: a public RPC can time out on a transaction that was in fact mined, so every staging step checks on-chain state first and after any error, and a queue that already holds a prefix of its lenders is continued rather than paid out. A run costs the reactive contract about 1.6 lREACT (it reacts to every deposit and request). `replay` and `casestudy` only read chains (Lasna keeps recent history, so run them soon after the race and the failed run, then commit the output).

### 16. Summarize

```bash
npm run summary          # results/SUMMARY.md and summary.json
npx tsx src/readme.ts    # regenerates the README's results and address sections
```

---

## Phase E: Dashboard

### 17. Build and host it

```bash
cd dashboard && npm install && npm run build     # static site in dashboard/out
```

Host `dashboard/out` anywhere static (Vercel, GitHub Pages). On Vercel, set the project's root directory to `dashboard`.

Optional: set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building (a free project id from [Reown Cloud](https://cloud.reown.com); on Vercel, add it to the project's environment variables). It adds WalletConnect, for mobile wallets and QR codes, to the wallet list of the *Live demo* and *Quick repay* panels. Without it, browser-extension wallets (MetaMask, Phantom, Coinbase Wallet, Rabby) still work.

**Check:** open it in a private window. The site root is the landing page (3D logo, measured numbers, race chart); the live dashboard is at `/dashboard/`. There the race chart, latency tables, example loops and live state all show real data. Run a loop and watch events appear. In the *Live demo* and *Quick repay* panels, *Connect wallet* opens a list of the wallets installed in your browser.

---

## Phase F: Submit

See [SUBMISSION.md](SUBMISSION.md): the form answers, the demo script, and a final checklist. Submit a day before the deadline (**Dec 5, 20:00 UTC**).

---

## Troubleshooting (all hit during this build)

| Symptom | Cause | Fix |
|---|---|---|
| `transaction gas price below minimum: gas tip cap 0, minimum needed 1` on Lasna | viem estimates a zero priority fee; Lasna rejects it | Pass `maxPriorityFeePerGas` explicitly (the harness does; for `cast` use `--priority-gas-price 1gwei`) |
| `ReentrancySentryOOG` revert on a simple storage write (Unichain) | The node's gas estimate came out just under the real need | Add a 30% buffer to the estimate (the harness does) |
| `eth_getLogs is limited to a 200 range` (Base Sepolia public RPC) | Provider limits log queries to 200 blocks | Query in chunks of 150 blocks (the dashboard does) |
| Callbacks stop arriving | A contract is in debt (reactive on Lasna, or a callback contract on its chain's proxy) | `depositTo` on the system contract or the callback proxy. `npm run status` shows debt |
| Callback never arrives | Gas limit under 100,000 is silently ignored; wrong proxy or reactive address in the callback contract constructor (immutable, so redeploy) | Check with `getCallbacks(reactiveTxHash)` on the system contract |
| Callback first argument is wrong | Payload must start with an `address` placeholder (`address(0)`), which the network overwrites with the reactive contract's address | Reserve the first argument |
| Next.js build: "TypeScript 7.0.2 is not supported" | npm installed TypeScript 7 | `npm install -D typescript@^6` |
| `EBUSY: resource busy` on `next build` | A preview server is holding `dashboard/out` | Stop it, or serve a copy of `out` |
| Phantom in a dashboard wallet panel: "The Provider is not connected to the requested chain." | Phantom's testnets are off, so it can't switch to Base Sepolia | In Phantom: Settings → Developer Settings → Testnet Mode, then try again; or connect MetaMask |
| Race results look too good for Sluice | The competitor bot was slow (read the market, estimated gas) | The competitor must fire immediately with a fixed gas limit and no pre-read |
| A timing run shows the reactive tx earlier than its origin | Block timestamps resolve to 1 s and chain clocks differ slightly | Use wall-clock timing for precision |
| Python on Windows adds `\r` to piped output, so `cast` says `invalid tx hash` | CRLF line endings | Strip with `tr -d '\r'` |
