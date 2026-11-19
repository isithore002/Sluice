import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, unichainSepolia } from "viem/chains";
import { need } from "./env.js";

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: ["https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
});

/**
 * Lasna rejects transactions with a zero priority fee ("gas tip cap 0, minimum needed 1"), which is what viem
 * estimates by default, so it is passed explicitly on every Lasna write (see util.send). 1 gwei is far above the
 * minimum and costs a negligible amount of lREACT.
 */
export const LASNA_PRIORITY_FEE = 1_000_000_000n;

const rawKey = need("PRIVATE_KEY").trim();
export const account: Account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

export interface ChainClients {
  name: "base" | "uni" | "lasna";
  chain: Chain;
  pub: PublicClient<Transport, Chain>;
  wallet: WalletClient<Transport, Chain, Account>;
  explorer: string;
}

function make(name: ChainClients["name"], chain: Chain, url: string): ChainClients {
  const transport = http(url, { retryCount: 6, retryDelay: 300, timeout: 30_000 });
  return {
    name,
    chain,
    pub: createPublicClient({ chain, transport, pollingInterval: 100 }),
    wallet: createWalletClient({ chain, transport, account }),
    explorer: chain.blockExplorers?.default.url ?? "",
  };
}

export const base = make("base", baseSepolia, need("BASE_SEPOLIA_RPC"));
export const uni = make("uni", unichainSepolia, need("UNICHAIN_SEPOLIA_RPC"));
export const rnk = make("lasna", lasna, need("LASNA_RPC"));

export function txUrl(c: ChainClients, hash: string): string {
  return `${c.explorer}/tx/${hash}`;
}
