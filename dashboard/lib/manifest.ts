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

/** One recorded round of the latency race, enriched with the Omni (Lasna) transactions that reacted. */
export interface ReplayRound {
  round: number;
  /** 1-based position of this round within its (speed, competitor delay) cell: native and +6 rounds with the same index pair up. */
  index: number;
  /** 0 = Omni native speed, 6 = the same system slowed by 6 Lasna blocks (~legacy). */
  delayBlocks: number;
  competitorDelayS: number;
  /** Amount of liquidity freed by the repayment (6-decimal units). */
  x: string;
  sluiceGot: string;
  competitorGot: string;
  capture: number;
  sluiceActedAfterMs: number;
  competitorSentAfterMs: number;
  competitorLandedAfterMs: number;
  competitorOk: boolean;
  txs: { repay: string; competitor: string; sluice: string; reactive?: string; reactiveRequested?: string };
  links: { repay: string; competitor: string; sluice: string; reactive?: string; reactiveRequested?: string };
  chain?: { repayBlock: string; sluiceBlock: string; competitorBlock: string; reactiveBlock?: string; requestedBlock?: string };
}

export interface RaceReplay {
  generatedAt: string;
  source: string;
  rounds: ReplayRound[];
}

export interface BatchCallback {
  batch: number;
  tx: string;
  link: string;
  block: string;
  chainSecondsAfterRepay: number;
  payments: number;
  firstRequestId: number;
  lastRequestId: number;
  gasUsed: number;
  gasLimitRequested: number;
}

/** One repayment that paid more queued withdrawals than a single callback may (flow D). */
export interface BatchResult {
  ok: boolean;
  date: string;
  n: number;
  each: string;
  total: string;
  cap: number;
  firstRequestId: number;
  txs: { repay: string };
  links: { repay: string };
  callbacks: BatchCallback[];
  reactive: { tx: string; link: string; block: string; attempt: number; chainSecond: number | null }[];
  timing: { repayToFirstBatchMs: number | null; repayToQueueEmptyMs: number; firstBatchToQueueEmptyMs: number | null };
  fifo: { ok: boolean; ids: number[] };
  allLendersPaidInFull: boolean;
  queued: { requestId: number; owner: string; tx: string; link: string }[];
}

export interface CaseStep {
  key: string;
  label: string;
  chain: "base" | "uni" | "lasna";
  tx: string;
  link: string;
  block: string;
  ts: number | null;
  status: "ok" | "failed";
  note?: string;
}

/** The one cross-chain loop that is not in the 31/32: reconstructed from chain data. */
export interface CaseStudy {
  generatedAt: string;
  counts: { attempted: number; recorded: number; completedOnChain: number };
  /** Everything the user and the relayer were owed had happened by the time the harness step failed. */
  outcome: { userPaid: string; relayerReimbursed: string; fillStage: string; requestId: number };
  steps: CaseStep[];
  failure: {
    tx: string;
    link: string;
    chain: "uni";
    contract: string;
    call: string;
    gasLimit: number;
    gasUsed: number;
    status: string;
    block: string;
    cause: string;
  };
  fix: { description: string; file: string };
  rerun: { file: string; loops: number; succeeded: number; examples: { loop: number; links: Record<string, string>; userPaidMs: number; relayerReimbursedMs: number }[] };
}

export interface Manifest {
  generatedAt: string;
  deployed: boolean;
  addresses: Record<string, string>;
  summary: Summary | null;
  raceReplay: RaceReplay | null;
  batch: BatchResult | null;
  caseStudy: CaseStudy | null;
}

export async function loadManifest(): Promise<Manifest> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const res = await fetch(`${base}/data/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const m = (await res.json()) as Partial<Manifest> & Pick<Manifest, "generatedAt" | "deployed" | "addresses" | "summary">;
  return { raceReplay: null, batch: null, caseStudy: null, ...m };
}
