# Sluice

**Withdrawal queues that settle themselves.** When a vault runs out of free liquidity, withdrawals queue up first come, first served. A Reactive Network contract watches every place liquidity can come back from (repayments in a Morpho Blue market on Base Sepolia, or pre-committed surplus on Unichain Sepolia) and pays the queue within seconds, with no manager and no bot.

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon), track **Every Second Counts**.

> Work in progress. The full README (results, addresses, transaction hashes, demo) lands before submission.

- Spec: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Plan: [docs/PLAN.md](docs/PLAN.md)

## Setup

Requires [Foundry](https://book.getfoundry.sh/) (tested with 1.5.1).

```shell
git clone --recurse-submodules <repo-url>
cd sluice
cp .env.example .env   # then fill in PRIVATE_KEY (testnet-only wallet)
forge build
forge test
```

Pinned dependencies (see `foundry.lock`): `reactive-lib-omni@v0.1.0`, `reactive-test-lib` (`omni` branch), `system-smart-contracts@8f7b902`, `morpho-blue@v1.0.0`, `openzeppelin-contracts@v5.6.1`, `forge-std@v1.17.0`.
