import type { ChainKey } from "../../lib/config";

/** 6-decimal token units to a readable number. */
export const usd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const usdStr = (v: string | number) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const secs = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "n/a");
export const secs1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const short = (h: string, a = 6, b = 4) => `${h.slice(0, a + 2)}…${h.slice(-b)}`;

export const ago = (t: number | null) => {
  if (!t) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/**
 * Reactive's callback signers, observed sending callbacks on Base Sepolia and Unichain Sepolia. Reactive rotated its signer between
 * 2026-11-19 and 2026-11-23: the first address sent every callback up to the 19th, the second sends them now, and each proxy
 * authorizes only the current one. All lowercase on purpose.
 */
export const REACTIVE_SIGNERS = [
  "0xf9f61c1d3325e2d4abb55dd9e0db84f7a0d914b0", // current
  "0xf7e866d726658f6c3f14b8ee537fe268a4d91ddb", // until 2026-11-19 at least
] as const;
export const REACTIVE_SIGNER = REACTIVE_SIGNERS[0];
export const isReactiveSigner = (from: string | null) => !!from && (REACTIVE_SIGNERS as readonly string[]).includes(from.toLowerCase());
export const whoSent = (from: string | null) =>
  !from ? "" : isReactiveSigner(from) ? "sent by Reactive's signer" : `sent by ${from.slice(0, 6)}…${from.slice(-4)}`;

/** CSS class of the chain chip for a chain key. */
export const chipClass: Record<ChainKey, string> = { base: "base", lasna: "lasna", uni: "uni" };
export const chainName: Record<ChainKey, string> = { base: "Base", lasna: "Lasna", uni: "Unichain" };
