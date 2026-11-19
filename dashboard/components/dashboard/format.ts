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

/** Reactive's signer, observed sending every callback on Base Sepolia and Unichain Sepolia. */
export const REACTIVE_SIGNER = "0xf7e866d726658f6c3f14b8ee537fe268a4d91ddb";
export const isReactiveSigner = (from: string | null) => !!from && from.toLowerCase() === REACTIVE_SIGNER;
export const whoSent = (from: string | null) =>
  !from ? "" : isReactiveSigner(from) ? "sent by Reactive's signer" : `sent by ${from.slice(0, 6)}…${from.slice(-4)}`;

/** CSS class of the chain chip for a chain key. */
export const chipClass: Record<ChainKey, string> = { base: "base", lasna: "lasna", uni: "uni" };
export const chainName: Record<ChainKey, string> = { base: "Base", lasna: "Lasna", uni: "Unichain" };
