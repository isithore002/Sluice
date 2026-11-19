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
  const transport = http(url, { retryCount: 6, retryDelay: 300 });
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
