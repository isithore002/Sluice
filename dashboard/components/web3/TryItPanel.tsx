"use client";

import { TryIt, type TryItProps } from "../dashboard/TryIt";
import { Web3Providers } from "./Providers";

/**
 * wagmi and RainbowKit around the quick-repay panel. The dashboard loads this with next/dynamic (no SSR), so the wallet
 * libraries stay out of its first-load JavaScript.
 */
export default function TryItPanel(props: TryItProps) {
  return (
    <Web3Providers>
      <TryIt {...props} />
    </Web3Providers>
  );
}
