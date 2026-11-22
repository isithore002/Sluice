"use client";

import { DemoStage, type DemoStageProps } from "../demo/DemoStage";
import { Web3Providers } from "./Providers";

/** The lender/borrower live demo inside the wallet providers; loaded with next/dynamic (no SSR) like the quick-repay panel. */
export default function DemoStagePanel(props: DemoStageProps) {
  return (
    <Web3Providers>
      <DemoStage {...props} />
    </Web3Providers>
  );
}
