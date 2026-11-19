export interface Stats {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}

export interface RaceCell {
  delayBlocks: number;
  competitorDelayS: number;
  rounds: number;
  meanCapture: number;
  sluiceActedMs: Stats;
}

export interface Summary {
  generatedAt: string;
  flowB: {
    attempted: number;
    succeeded: number;
    totalWallMs: Stats;
    originToReactiveWallMs: Stats;
    reactiveToCallbackWallMs: Stats;
    totalChainSeconds: Stats;
    example: Record<string, string> | null;
  };
  flowC: {
    attempted: number;
    succeeded: number;
    userPaidWallMs: Stats;
    relayerReimbursedWallMs: Stats;
    userPaidChainSeconds: Stats;
    example: Record<string, string> | null;
  };
  independent: {
    attempted: number;
    succeeded: number;
    allIndependent: boolean;
    totalWallMs: Stats;
    example: { links: Record<string, string>; actors: Record<string, string> } | null;
  };
  race: RaceCell[];
}

export interface Manifest {
  generatedAt: string;
  deployed: boolean;
  addresses: Record<string, string>;
  summary: Summary | null;
}

export async function loadManifest(): Promise<Manifest> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const res = await fetch(`${base}/data/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  return res.json();
}
