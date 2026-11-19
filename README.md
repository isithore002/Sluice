# Sluice

**Withdrawal queues that settle themselves.**

When a lending vault runs out of free cash, withdrawals queue up. Today someone (a manager, a keeper bot) has to notice when cash comes back and pay the queue, and in a crunch whoever runs the fastest bot grabs freed liquidity first. Sluice replaces that operator with a Reactive contract. It watches every place liquidity can come back from and pays the queue **first come, first served, within seconds**. Liquidity comes back from:

- a repayment in a Morpho Blue market Sluice doesn't control;
- spare credit in a sibling vault on another chain;
- a new deposit.

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon), track **Every Second Counts**. It implements two ideas from that track's brief: *"withdrawal queues that settle the moment they can"* and *"liquidity that moves to wherever it's needed."*

| | |
|---|---|
| Networks | Reactive Lasna (5318007), Base Sepolia (84532), Unichain Sepolia (1301) |
| Protocol integrated | Morpho Blue (the live deployment on Base Sepolia, `0xBBBB…FFCb`) |
| Tests | 62 passing, against **Morpho's real bytecode** and **the real Omni system contracts** |
| Results | Latency loops and the latency race: *pending live runs, see [Results](#results)* |

---

## The problem

- **Depositors get stuck when liquidity runs out.** Euler and Morpho vaults hit 100% utilization during the [November 2025 liquidity crunch](https://sentora.com/research/articles/defi-s-november-liquidity-crunch-causes-and-impacts). Aave's ETH, USDT and USDC pools hit full utilization after the [April 2026 KelpDAO exploit](https://parameter.io/aave-aave-loses-15-billion-in-tvl-following-kelpdao-security-breach/). In both cases lenders couldn't withdraw.
- **Queued withdrawals wait for an operator.** Async vaults ([ERC-7540](https://ethereum.org/developers/docs/standards/tokens/erc-7540/)) queue redemptions, but a manager or bot decides when to pay them. Cross-chain vaults add [bridge latency](https://centrifuge.io/blog/asynchronous-vaults) on top.
- **Freed liquidity goes to the fastest bot.** It doesn't go to whoever has waited longest.

## How it works

```
 Base Sepolia                        Reactive Lasna                       Unichain Sepolia
┌───────────────────────────┐      ┌──────────────────────────────┐      ┌─────────────────────────┐
│ Morpho Blue (third party) │─────▶│                              │      │                         │
│   our isolated market     │Repay │        SluiceReactive        │◀─────│ SiblingVault            │
│                           │      │                              │credit│  surplus above a safety │
│ SluiceVault               │─────▶│  absolute caches, per-fill   │      │  buffer → credit        │
│   FIFO queue, partial     │state │  stages, Cron10 retries,     │      │                         │
│   fills, reservation rule │      │  bad-debt halt, delay mode   │──2──▶│ reimburse(fill, sent)   │
│   pullFromMorpho() ◀──────┼──────│                              │      └─────────────────────────┘
│                           │      │                              │
│ RelayerReserve            │─────▶│                              │
│   front(fill) ◀───────1───┼──────│                              │
└───────────────────────────┘Front-└──────────────────────────────┘
                              ed      1 = front pays the user in one hop
                                      2 = reimburse only after Fronted, for exactly what was sent
```

Three liquidity sources, three flows:

| Flow | Trigger | What happens | Needs Reactive? |
|---|---|---|---|
| **A** | A deposit into the vault | Pays the queue in the same transaction | No, and deliberately so: our own vault can do it synchronously |
| **B** | A borrower repays in **Morpho** | SluiceReactive sees `Repay` (filtered to our market id) and calls `pullFromMorpho`. The vault withdraws and pays the queue in order | **Yes**: a vault can't hook a protocol it doesn't control |
| **C** | Base can't cover the queue, Unichain has credit | SluiceReactive asks the Base reserve to **front** the payout (the user is paid after one hop). After seeing `Fronted`, it asks Unichain to **reimburse** the relayer for exactly the amount sent | **Yes**: nothing on Unichain can trigger anything on Base without it |

### Rules the contracts enforce

- **FIFO with partial fills.** The head of the queue is paid as much as possible before anyone behind it, with at most 25 payments per call to bound gas.
- **Reservation rule.** While anyone is queued, new withdrawals queue behind them and idle assets only leave the vault to pay the queue. Nobody can jump the line.
- **Reimburse only what was sent.** The relayer is reimbursed only after its front is confirmed on Base, and only for the amount actually sent. A failed front is never reimbursed.
- **Safety buffer.** The Unichain vault only commits surplus above a buffer as credit, so local liquidity is never fully exported.
- **Bad-debt halt.** A Morpho `Liquidate` with bad debt in our market stops all cross-chain fronting until the owner resumes it. Sluice won't pull healthy liquidity from another chain into a troubled market.

### Robustness (designed for a network that can drop or repeat events)

- **Absolute values.** Every cached value is overwritten by events carrying absolute values. There are no running counters to drift.
- **Idempotent destinations.** `front` and `reimburse` are idempotent per fill id and **re-emit their stored result** on repeats, so a retry heals a missed confirmation.
- **Fresh state before confirmation.** The reserve always lets the vault publish fresh state *before* confirming a front. Even if both events of an execution are missed, a retry can't cause a double front. Our test suite found this case.
- **Bounded retries.** Retries run on Cron10 with exponential backoff, at most 3, and Cron is subscribed only while something is in flight, because ticks are billed.
- **No billed reverts.** `react()` never reverts to filter events. The vault's pull never reverts when there's nothing to do.

## Why Reactive, and why Omni

**Reactive** is what lets a vault respond to things it can't hook: a third party's repayment in Morpho, or a credit line on another chain. No server and no keeper.

**Omni**'s ~1s blocks matter when freed liquidity is **contested**. At 100% utilization, every lender wants out, and whoever acts first after a repayment gets the funds. We measure this directly with a **latency race**:

- A competitor bot (another lender in the same market) tries to withdraw freed liquidity *C* seconds after each repayment.
- We measure the share the queue captures with Sluice at native Omni speed, and with the *same contracts* slowed by `delayBlocks = 6` to approximate legacy (~7s) speed.

## Results

> **Pending live runs.** The harness, the race and the dashboard are built and tested. Numbers appear here after the live testnet runs (`harness/`, then `npm run summary` writes `results/SUMMARY.md`). Nothing below will be estimated or simulated.

- Flow B latency (repay → queue paid): *pending*
- Flow C latency (shortfall → user paid, and → relayer reimbursed): *pending*
- Latency race (queue capture at Omni vs ~legacy speed): *pending*

## Deployed contracts

*Pending live deployment.* After `scripts/deploy.sh`, addresses are in [`deployments/`](deployments/) and every deployment transaction is in `broadcast/`.

---

## Repository layout

| Path | What's there |
|---|---|
| [`src/`](src/) | `SluiceVault`, `SluiceReactive`, `RelayerReserve`, `SiblingVault`, interfaces, mocks |
| [`test/`](test/) | 62 tests: vault, reserve, sibling, reactive (through the Omni pipeline), end to end |
| [`script/`](script/), [`scripts/deploy.sh`](scripts/deploy.sh) | 8-step deployment across the three chains |
| [`harness/`](harness/) | `status`, `flowB`, `flowC`, `race`, `summary` (TypeScript + viem) |
| [`dashboard/`](dashboard/) | Live read-only dashboard (Next.js static export) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full spec: verified addresses, every function and event, flows, failure modes |
| [`docs/BUILD_GUIDE.md`](docs/BUILD_GUIDE.md) | Step-by-step guide from an empty machine to a running deployment |

## Quick start

Requires [Foundry](https://book.getfoundry.sh/) 1.5.x and Node.js 22.

```shell
git clone --recurse-submodules https://github.com/isithore002/Sluice.git
cd Sluice
forge build
forge test          # 62 tests, no network needed
```

### How the tests work

- **Real Morpho.** `test/fixtures/morpho-blue-runtime.hex` is Morpho Blue's runtime bytecode, captured from Base Sepolia. Tests run it at its real address and enable the same IRM and LLTV that are enabled on Base Sepolia. The vault is tested against the real lending logic, not a mock.
- **Real Omni pipeline.** [`reactive-test-lib`](https://github.com/Reactive-Network/reactive-test-lib) (`omni` branch) runs the real Omni system contract and callback proxies. That covers subscription matching, `react()`, the Cron cascade and callback delivery with the injected sender.
- **Controlled event streams.** Reactive unit tests drive SluiceReactive with exact event streams, including dropped, duplicated and reordered confirmations. End-to-end tests wire every real contract together.

### Deploy

```shell
cp .env.example .env      # set PRIVATE_KEY (testnet-only wallet); optionally provider RPC URLs
scripts/deploy.sh         # 8 steps: Base market → Uni token → Lasna reactive → Base vault/reserve
                          #          → Uni sibling → Lasna configure → seed Base → seed Uni
```

The wallet needs Base Sepolia ETH, Unichain Sepolia ETH and Lasna lREACT. The scripts fund each callback contract on its chain's callback proxy and fund the reactive contract with lREACT.

### Measure

```shell
cd harness && npm install
npm run status                       # funds, debts, queue, caches
npm run flowB -- --n 30 --x 10       # repay → queue paid
npm run flowC -- --n 30 --x 10       # shortfall → fronted → reimbursed
npm run race -- --rounds 10          # Omni vs ~legacy speed against competitor bots
npm run summary                      # results/SUMMARY.md
```

Every loop is traced by its origin transaction hash, which every callback carries and every event emits. The harness records:

- **Wall-clock milliseconds**, polling every ~150ms.
- **Block timestamps**, which on Base Sepolia only resolve to 1 second (about 5 blocks share each timestamp).

### Dashboard

```shell
cd dashboard && npm install && npm run build    # static site in dashboard/out
```

## Limitations and claims we don't make

- **It can't create liquidity.** If every chain is drained, the queue waits.
- **A same-block searcher beats Sluice** to freed Morpho liquidity, and beats any reactive system. Inside the vault, the reservation rule guarantees order.
- **Cross-chain uses a pre-funded relayer reserve and pre-committed credit,** not a bridge. Both are capital set aside in advance. **We don't claim Sluice reduces idle capital.**
- **The ~legacy comparison is simulated** by adding delay on Omni. It's not a run on the legacy network.
- **The demo market uses `irm = address(0)`,** so there's no interest. Vault shares are 1:1, and the vault is ERC-7540-*style*, not a full ERC-7540 implementation.
- **The demo actors** (borrower, competitor, relayer) are our scripts, acting against a real Morpho deployment.

## License

[MIT](LICENSE). Built during the Reactive Omni Buildathon (Nov 5 – Dec 5, 2026). Dependencies keep their own licenses.
