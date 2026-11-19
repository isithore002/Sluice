import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: ["https://lasna-rpc.rnk.dev/"] } },
});

export type ChainKey = "base" | "uni" | "lasna";

interface ChainInfo {
  key: ChainKey;
  label: string;
  chain: Chain;
  rpc: string;
  explorer: string;
  /** How far back the event feed looks on first load (blocks). */
  window: bigint;
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  base: {
    key: "base",
    label: "Base Sepolia",
    chain: baseSepolia,
    rpc: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    window: 1500n,
  },
  uni: {
    key: "uni",
    label: "Unichain Sepolia",
    chain: unichainSepolia,
    rpc: process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC || "https://sepolia.unichain.org",
    explorer: unichainSepolia.blockExplorers?.default.url ?? "https://sepolia.uniscan.xyz",
    window: 300n,
  },
  lasna: {
    key: "lasna",
    label: "Reactive Lasna",
    chain: lasna,
    rpc: process.env.NEXT_PUBLIC_LASNA_RPC || "https://lasna-rpc.rnk.dev/",
    explorer: "https://lasna.reactscan.net",
    window: 300n,
  },
};

export const clients: Record<ChainKey, PublicClient> = {
  base: createPublicClient({ chain: CHAINS.base.chain, transport: http(CHAINS.base.rpc) }) as PublicClient,
  uni: createPublicClient({ chain: CHAINS.uni.chain, transport: http(CHAINS.uni.rpc) }) as PublicClient,
  lasna: createPublicClient({ chain: CHAINS.lasna.chain, transport: http(CHAINS.lasna.rpc) }) as PublicClient,
};

export const PROXIES = {
  base: "0x476F44b11F5C942c58f4c8E3d0300E5710743585",
  uni: "0x775c9B990ADe401060B78D0e98684eEf8d2466C1",
  system: "0x8888888888888888888888888888888888888888",
} as const;

export const txUrl = (k: ChainKey, hash: string) => `${CHAINS[k].explorer}/tx/${hash}`;
export const addrUrl = (k: ChainKey, a: string) => `${CHAINS[k].explorer}/address/${a}`;
