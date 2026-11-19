# Deployments

Written by the forge scripts in `script/` (run them with `scripts/deploy.sh`):

| File | Chain | Contents |
|---|---|---|
| `base-market.json` | Base Sepolia (84532) | MockUSD, MockCollateral, FixedOracle, Morpho address, market id |
| `unichain-token.json` | Unichain Sepolia (1301) | MockUSD |
| `lasna-reactive.json` | Reactive Lasna (5318007) | SluiceReactive |
| `base-sluice.json` | Base Sepolia | SluiceVault, RelayerReserve |
| `unichain-sluice.json` | Unichain Sepolia | SiblingVault |

Transaction hashes for every deployment step are in `broadcast/`.
