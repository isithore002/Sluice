# Omni field notes

Things we verified directly on Reactive Lasna, Base Sepolia and the system-contract source while building Lifeline
(2026-11-23). Each item says how it was checked. Raw evidence: [`results/lifeline-probe.json`](../results/lifeline-probe.json)
and [`results/lifeline-remote-probe.json`](../results/lifeline-remote-probe.json).

| # | Finding | How verified |
|---|---|---|
| 1 | A contract with debt above zero is blacklisted. `BlacklistContract(address indexed)` is emitted by the system contract (reactive contracts) or the callback proxy (callback recipients), when debt goes from zero to above zero. `WhitelistContract(address indexed)` is emitted when a deposit clears it. Neither carries data. | Read `AbstractProxiedPayableBridge.sol`; saw both events on Lasna's system contract `0x8888…8888`; saw them on the Base proxy |
| 2 | A reactive contract deployed with no funds is blacklisted on its first reaction. One Cron10 reaction cost 0.0155 lREACT of debt. | Deployed a probe contract; blacklisted within one block of its first tick |
| 3 | A reactive contract can subscribe to the system contract's own `BlacklistContract` / `WhitelistContract` events on Lasna and they are delivered to `react()`. | Lifeline reacted to both for a watched target |
| 4 | `SYSTEM.depositTo{value}(target)` works when called from inside `react()`. | Lifeline cleared a target's debt and paid a top-up from `react()` in the very next block |
| 5 | The callback proxy on Base Sepolia emits the same events per recipient, so a reactive contract can watch one recipient with an ordinary cross-chain subscription (topic1 = the recipient). | Lifeline watched a sink on Base and reacted to its blacklist |
| 6 | A callback recipient is charged after its callback runs, so the call that causes the debt still executes. | Sink recorded its first ping, then was blacklisted in the same transaction |
| 7 | A recipient gets roughly `gasLimit - (extraGas + maxChargeGas)` of gas, which is 80,000 + 50,000 on Base Sepolia. A 200,000 request left about 70,000, a first-write callback ran out of gas, the proxy emitted `CallbackFailure`, and the recipient was still billed. | Read `CallbackProxy._callback`; read the proxy's `_extraGas` and `_maxChargeGas`; five failed callbacks drained a sink's reserve; a 500,000 request worked |
| 8 | Cron events on Lasna are still emitted from `0x0000000000000000000000000000000000fffFfF` (Cron1 each block, Cron10 every 10 blocks). | Queried logs from that address |
| 9 | Blacklisting is not rare on the testnet: three contracts were blacklisted in about 80 minutes. | Counted `BlacklistContract` logs on Lasna |
| 10 | Debt blacklists a contract silently: nothing reverts and no one is told. Lifeline's measured blacklist-to-revival time was about one second on both paths (one Lasna block locally, five Base blocks cross-chain, timestamps resolve to 1 s). | Event timestamps in the two result files |
| 11 | Lasna's faucet is slow. Three payments (0.095 ETH total) were paid out after about 1 to 1.5 hours, all at 100 lREACT per ETH. | Watched the wallet's balance |
| 12 | Base Sepolia's public RPC refuses `eth_getLogs` over 200 blocks. | Error `-32614` |

## Not verified

- A rescued contract's missed events are not replayed. Rescue restores delivery going forward only.
- Origin-chain reorg handling and ordering across logs are not documented and were not tested.
- The local-target path was tested only against a Cron probe contract, not against SluiceReactive.
- Nothing here was run on Reactive Mainnet.
