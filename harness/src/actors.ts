/**
 * Separate wallets that play users and outsiders, so loops are not all triggered by the deployer.
 * Keys are generated once and kept locally in harness/.actors.json (gitignored); they only ever hold testnet dust.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { base, type ChainClients } from "./chains.js";
import { ABI, ADDR } from "./contracts.js";
import { ROOT, need } from "./env.js";
import { read, send } from "./util.js";

const ACTORS_FILE = resolve(ROOT, "harness", ".actors.json");
const GAS_FUND = 500_000_000_000_000n; // 0.0005 ETH: Base gas for a whole run is a fraction of that

export type Actor = ChainClients & { address: Address };

export function actorKeys(): { alice: Hex; bob: Hex } {
  if (existsSync(ACTORS_FILE)) return JSON.parse(readFileSync(ACTORS_FILE, "utf8"));
  const keys = { alice: generatePrivateKey(), bob: generatePrivateKey() };
  writeFileSync(ACTORS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

export function asActor(key: Hex): Actor {
  const account = privateKeyToAccount(key);
  const transport = http(need("BASE_SEPOLIA_RPC"), { retryCount: 6, retryDelay: 300, timeout: 30_000 });
  return { ...base, wallet: createWalletClient({ chain: baseSepolia, transport, account }), address: account.address };
}

export function actors(): { alice: Actor; bob: Actor } {
  const keys = actorKeys();
  return { alice: asActor(keys.alice), bob: asActor(keys.bob) };
}

/** The deployer tops up an actor's gas when it runs low. */
export async function ensureGas(a: Address, log: (s: string) => void = () => {}) {
  const bal = await base.pub.getBalance({ address: a });
  if (bal >= GAS_FUND / 2n) return;
  const hash = await base.wallet.sendTransaction({ to: a, value: GAS_FUND });
  await base.pub.waitForTransactionReceipt({ hash });
  log(`  funded ${a} with gas`);
}

export async function ensureAllowance(c: Actor, spender: Address, atLeast: bigint) {
  const allowance = await read<bigint>(base, ADDR.usd, ABI.usd, "allowance", [c.address, spender]);
  if (allowance < atLeast) await send(c, ADDR.usd, ABI.usd, "approve", [spender, 2n ** 256n - 1n]);
}

export async function ensureBalance(c: Actor, x: bigint) {
  const bal = await read<bigint>(base, ADDR.usd, ABI.usd, "balanceOf", [c.address]);
  if (bal < x) await send(c, ADDR.usd, ABI.usd, "mint", [c.address, x - bal]);
}
