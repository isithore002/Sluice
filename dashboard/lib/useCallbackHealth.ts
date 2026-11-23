"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { encodeFunctionData, parseAbi } from "viem";
import { clients, PROXIES, type ChainKey } from "./config";

/** Reactive's signer: the account that has sent every callback we have seen on Base Sepolia and Unichain Sepolia. */
// All lowercase on purpose: viem rejects a mixed-case address whose checksum is not exactly right.
export const REACTIVE_SIGNER = "0xf7e866d726658f6c3f14b8ee537fe268a4d91ddb" as Address;

/** `NotAuthorized()`: what a callback proxy answers when the sender is not one of its operators (its `onlyOperators` check). */
const NOT_AUTHORIZED = "0xea8e4eb5";

export type Verdict = "accepted" | "rejected" | "unknown";

export interface CallbackHealth {
  base: Verdict;
  uni: Verdict;
  checkedAt: number | null;
}

const deliverAbi = parseAbi(["function deliverCallback(uint8 version, bytes config)"]);
// An empty configuration: an authorized sender gets past the operator check and then fails to decode it (a different revert),
// so nothing is ever delivered and nothing changes on-chain. A read-only eth_call, no signature involved.
const PROBE_DATA: Hex = encodeFunctionData({ abi: deliverAbi, functionName: "deliverCallback", args: [0, "0x"] });

function revertData(e: unknown): string {
  const parts: string[] = [];
  let x = e as { data?: unknown; message?: string; details?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 8; i++) {
    if (typeof x.data === "string") parts.push(x.data);
    else if (x.data && typeof (x.data as { data?: unknown }).data === "string") parts.push((x.data as { data: string }).data);
    if (x.message) parts.push(x.message);
    if (x.details) parts.push(x.details);
    x = x.cause as typeof x;
  }
  return parts.join(" ").toLowerCase();
}

/** Asks one callback proxy whether it would accept Reactive's signer right now. */
async function probe(chain: ChainKey): Promise<Verdict> {
  const to = chain === "base" ? PROXIES.base : PROXIES.uni;
  try {
    // batch: false keeps this a raw eth_call from the signer; a Multicall3 batch would change the sender and the answer.
    await clients[chain].call({ account: REACTIVE_SIGNER, to, data: PROBE_DATA, batch: false });
    return "accepted";
  } catch (e) {
    const text = revertData(e);
    if (text.includes(NOT_AUTHORIZED) || text.includes("notauthorized")) return "rejected";
    // Any other EXECUTION revert means the call got past the operator check (here, on decoding the empty configuration).
    // Anything that is not a revert (a network error, a rate limit, a timeout) says nothing about authorization.
    return text.includes("revert") ? "accepted" : "unknown";
  }
}

/**
 * Whether the callback proxies currently accept Reactive's signer. Live settlement only completes when they do: Reactive reacts on
 * Lasna either way, but a proxy that rejects the signer reverts every callback before it reaches our vault.
 */
export function useCallbackHealth(enabled: boolean): CallbackHealth {
  const [health, setHealth] = useState<CallbackHealth>({ base: "unknown", uni: "unknown", checkedAt: null });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const run = async () => {
      if (document.hidden) return;
      const [base, uni] = await Promise.all([probe("base"), probe("uni")]);
      if (!stopped) setHealth((h) => ({ base: base === "unknown" ? h.base : base, uni: uni === "unknown" ? h.uni : uni, checkedAt: Date.now() }));
    };
    void run();
    const id = setInterval(run, 30_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [enabled]);
  return health;
}
