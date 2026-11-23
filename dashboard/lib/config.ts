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

/**
 * Public RPCs rate-limit, and the dashboard polls a lot: balances, queue, events, three chains. So requests made in the
 * same moment are merged: eth_calls to one chain go out as a single Multicall3 call (Base and Unichain Sepolia have it,
 * Lasna does not), and everything else shares one JSON-RPC batch per HTTP request (all three RPCs accept batches).
 */
const client = (k: ChainKey) =>
  createPublicClient({ chain: CHAINS[k].chain, transport: http(CHAINS[k].rpc, { batch: true }), batch: { multicall: k !== "lasna" } }) as PublicClient;

export const clients: Record<ChainKey, PublicClient> = { base: client("base"), uni: client("uni"), lasna: client("lasna") };

export const PROXIES = {
  base: "0x476F44b11F5C942c58f4c8E3d0300E5710743585",
  uni: "0x775c9B990ADe401060B78D0e98684eEf8d2466C1",
  system: "0x8888888888888888888888888888888888888888",
} as const;

export const txUrl = (k: ChainKey, hash: string) => `${CHAINS[k].explorer}/tx/${hash}`;
export const addrUrl = (k: ChainKey, a: string) => `${CHAINS[k].explorer}/address/${a}`;
