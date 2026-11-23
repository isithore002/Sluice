"use client";

import { PoolView } from "../demo/PoolView";
import type { FeedEvent, LiveState } from "../../lib/useLive";
import { Web3Providers } from "./Providers";

interface Props {
  addresses: Record<string, string>;
  state: LiveState | null;
  events: FeedEvent[];
}

/** The live pool, queue and "what Reactive just did" panels inside the wallet providers (they mark the connected wallet's own tickets). */
export default function LivePoolPanel({ addresses, state, events }: Props) {
  return (
    <Web3Providers>
      <PoolView addresses={addresses} state={state} events={events} legend={false} />
    </Web3Providers>
  );
}
