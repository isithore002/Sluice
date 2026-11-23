"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { vaultAbi } from "../../lib/abis";
import { clients, txUrl } from "../../lib/config";
import { collateralFor, debtAssets, marketParams, maxBorrowFor, morphoWriteAbi, tokenAbi } from "../../lib/demo";
import { isReactiveSigner, short, usd } from "../dashboard/format";
import { StepRow, type StepState } from "./StepRow";
import { WalletGate, errText } from "./WalletGate";
import { useRoles } from "./roles";
import "./demo-borrower.css";

const POLL_MS = 5000;
const pullRequested = parseAbiItem("event PullRequested(uint256 indexed traceId, uint8 attempt)");

/** Collateral has 18 decimals. */
const col = (v: bigint) => (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 });

interface ChainData {
  walletCol: bigint;
  walletUsd: bigint;
  allowCol: bigint;
  allowUsd: bigint;
  posCollateral: bigint;
  borrowShares: bigint;
  debt: bigint;
  supply: bigint;
  borrowed: bigint;
}

async function readChain(a: Record<string, string>, who: Address): Promise<ChainData> {
  const b = clients.base;
  const morpho = a.morpho as Address;
  const id = a.marketId as Hex;
  const [walletCol, walletUsd, allowCol, allowUsd, pos, mkt] = await Promise.all([
    b.readContract({ address: a.mockCollateral as Address, abi: tokenAbi, functionName: "balanceOf", args: [who] }),
    b.readContract({ address: a.mockUSD as Address, abi: tokenAbi, functionName: "balanceOf", args: [who] }),
    b.readContract({ address: a.mockCollateral as Address, abi: tokenAbi, functionName: "allowance", args: [who, morpho] }),
    b.readContract({ address: a.mockUSD as Address, abi: tokenAbi, functionName: "allowance", args: [who, morpho] }),
    b.readContract({ address: morpho, abi: morphoWriteAbi, functionName: "position", args: [id, who] }),
    b.readContract({ address: morpho, abi: morphoWriteAbi, functionName: "market", args: [id] }),
  ]);
  const borrowShares = BigInt(pos[1]);
  return {
    walletCol,
    walletUsd,
    allowCol,
    allowUsd,
    posCollateral: BigInt(pos[2]),
    borrowShares,
    debt: borrowShares === 0n ? 0n : debtAssets(borrowShares, BigInt(mkt[2]), BigInt(mkt[3])),
    supply: BigInt(mkt[0]),
    borrowed: BigInt(mkt[2]),
  };
}

/** The borrower's whole job happens on Morpho. Sluice is never called from this tab. */
export function BorrowerTab({ addresses }: { addresses: Record<string, string> }) {
  const { address } = useAccount();
  const roles = useRoles("borrower", address);
  return (
    <div className="dm-b">
      <WalletGate
        role="Borrower"
        notice={
          roles.clash ? (
            <p className="sl-err">
              This is the wallet you used as the lender. A borrower should be a different wallet: switch accounts in your wallet, or the demo shows one
              person doing both roles.
            </p>
          ) : undefined
        }
      >
        {({ address: who }) => <BorrowerSteps key={who} who={who} addresses={addresses} onAct={roles.remember} />}
      </WalletGate>
    </div>
  );
}

interface Timeline {
  repayTx: Hex;
  repayBlock: bigint;
  repayTs: number;
  minedAtMs: number;
  lasnaFrom: bigint;
  /** True when this browser reloaded and found the repay again: the "browser saw it" timing no longer applies. */
  restored?: boolean;
}

// A reload right after the repay must not lose what the repayment set off. The repay's own hash is remembered for a few
// minutes (the public Lasna RPC is searched back about 290 blocks, so older repayments couldn't be followed anyway).
const REMEMBER_MS = 4 * 60_000;
const repayKey = (morpho: string, who: string) => `sluice-demo-borrower-repay-${morpho.toLowerCase()}-${who.toLowerCase()}`;
function loadRepay(morpho: string, who: string): Timeline | null {
  try {
    const raw = window.localStorage.getItem(repayKey(morpho, who));
    if (!raw) return null;
    const j = JSON.parse(raw) as { repayTx: Hex; repayBlock: string; repayTs: number; lasnaFrom: string; savedAt: number };
    if (Date.now() - j.savedAt > REMEMBER_MS) return null;
    return { repayTx: j.repayTx, repayBlock: BigInt(j.repayBlock), repayTs: j.repayTs, minedAtMs: j.savedAt, lasnaFrom: BigInt(j.lasnaFrom), restored: true };
  } catch {
    return null;
  }
}
function saveRepay(morpho: string, who: string, t: Timeline | null) {
  try {
    if (!t) window.localStorage.removeItem(repayKey(morpho, who));
    else window.localStorage.setItem(repayKey(morpho, who), JSON.stringify({ repayTx: t.repayTx, repayBlock: String(t.repayBlock), repayTs: t.repayTs, lasnaFrom: String(t.lasnaFrom), savedAt: Date.now() }));
  } catch {
    /* the page just won't remember it */
  }
}

function BorrowerSteps({ who, addresses, onAct }: { who: Address; addresses: Record<string, string>; onAct: (a: Address) => void }) {
  const { writeContractAsync } = useWriteContract();
  const [data, setData] = useState<ChainData | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<{ n: number; msg: string } | null>(null);
  const [txs, setTxs] = useState<Record<number, Hex>>({});
  const [timeline, setTimeline] = useState<Timeline | null>(() => loadRepay(addresses.morpho, who));
  const [repaid, setRepaid] = useState(() => loadRepay(addresses.morpho, who) !== null);
  const [readFails, setReadFails] = useState(0);
  const alive = useRef(true);

  const params = marketParams(addresses);
  const morpho = addresses.morpho as Address;
  const usdToken = addresses.mockUSD as Address;
  const colToken = addresses.mockCollateral as Address;

  const reload = useCallback(async () => {
    try {
      const d = await readChain(addresses, who);
      if (alive.current) {
        setData(d);
        setReadFails(0);
      }
    } catch {
      /* the next poll retries */
      if (alive.current) setReadFails((n) => n + 1);
    }
  }, [addresses, who]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const id = setInterval(reload, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [reload]);

  const newLoan = repaid && data !== null && data.debt > 0n;
  useEffect(() => {
    if (!newLoan) return;
    setRepaid(false);
    setTimeline(null);
    saveRepay(addresses.morpho, who, null);
  }, [newLoan, addresses.morpho, who]);

  if (!data) {
    return readFails >= 2 ? (
      <p className="sl-err">The public RPC isn&apos;t answering, so your position can&apos;t load yet. Retrying every {POLL_MS / 1000} s.</p>
    ) : (
      <p className="sl-note">Reading your position from Morpho…</p>
    );
  }

  const free = data.supply > data.borrowed ? data.supply - data.borrowed : 0n;
  const hasDebt = data.debt > 0n;
  let typed = 0n;
  try {
    typed = amountStr.trim() ? parseUnits(amountStr.trim(), 6) : 0n;
  } catch {
    typed = 0n;
  }
  const target = hasDebt ? data.debt : typed > 0n && typed < free ? typed : free;
  const reqCol = collateralFor(target);
  const needCol = reqCol > data.posCollateral ? reqCol - data.posCollateral : 0n;
  const maxBorrow = maxBorrowFor(data.posCollateral);

  const d4 = hasDebt || repaid;
  const d3 = d4 || (target > 0n && needCol === 0n);
  const d2 = d3 || (target > 0n && data.allowCol >= needCol);
  const d1 = d2 || (target > 0n && data.walletCol >= needCol);
  const d5 = repaid || (hasDebt && data.allowUsd >= data.debt);
  const d6 = repaid && !hasDebt;
  const done = [d1, d2, d3, d4, d5, d6];
  // Nothing to borrow yet (an empty pool): no step can start until a lender deposits.
  const blocked = target === 0n && !hasDebt && !repaid;
  const firstOpen = blocked ? -1 : done.findIndex((x) => !x);
  const stateOf = (i: number): StepState => {
    if (busy === i + 1) return "busy";
    if (done[i]) return "done";
    if (i === firstOpen) return failed?.n === i + 1 ? "error" : "active";
    return "todo";
  };

  async function send(n: number, run: () => Promise<Hex>) {
    setFailed(null);
    setBusy(n);
    try {
      onAct(who);
      const hash = await run();
      setTxs((t) => ({ ...t, [n]: hash }));
      const rc = await clients.base.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 120_000 });
      if (rc.status !== "success") throw new Error("The transaction reverted.");
      await reload();
      return { hash, rc };
    } catch (e) {
      setFailed({ n, msg: errText(e) });
      return null;
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const write = (args: Parameters<typeof writeContractAsync>[0]) => writeContractAsync({ ...args, chainId: baseSepolia.id } as never);

  const mint = () =>
    send(1, () =>
      write({ address: colToken, abi: tokenAbi, functionName: "mint", args: [who, needCol > data.walletCol ? needCol - data.walletCol : 1n] }),
    );
  const approveCol = () => send(2, () => write({ address: colToken, abi: tokenAbi, functionName: "approve", args: [morpho, needCol] }));
  const supply = () => send(3, () => write({ address: morpho, abi: morphoWriteAbi, functionName: "supplyCollateral", args: [params, needCol, who, "0x"] }));
  const borrow = async () => {
    if (target > maxBorrow) {
      setFailed({ n: 4, msg: `With ${col(data.posCollateral)} collateral you can borrow at most ${usd(maxBorrow)} mUSD.` });
      return;
    }
    await send(4, () => write({ address: morpho, abi: morphoWriteAbi, functionName: "borrow", args: [params, target, 0n, who, who] }));
  };
  const approveUsd = () => send(5, () => write({ address: usdToken, abi: tokenAbi, functionName: "approve", args: [morpho, data.debt + 1_000_000n] }));
  const repay = async () => {
    // Repaying by shares clears the whole debt exactly. Rounding can leave the debt a unit above the cash borrowed, so top up that unit if needed.
    if (data.walletUsd < data.debt) {
      const top = await send(6, () => write({ address: usdToken, abi: tokenAbi, functionName: "mint", args: [who, data.debt - data.walletUsd] }));
      if (!top) return;
    }
    let lasnaFrom = 0n;
    try {
      const latest = await clients.lasna.getBlockNumber();
      lasnaFrom = latest > 60n ? latest - 60n : 0n;
    } catch {
      /* the timeline falls back to a recent window */
    }
    const out = await send(6, () =>
      write({ address: morpho, abi: morphoWriteAbi, functionName: "repay", args: [params, 0n, data.borrowShares, who, "0x"] }),
    );
    if (!out) return;
    const blk = await clients.base.getBlock({ blockNumber: out.rc.blockNumber });
    const t: Timeline = { repayTx: out.hash, repayBlock: out.rc.blockNumber, repayTs: Number(blk.timestamp), minedAtMs: Date.now(), lasnaFrom };
    saveRepay(addresses.morpho, who, t);
    setRepaid(true);
    setTimeline(t);
  };

  const startOver = () => {
    saveRepay(addresses.morpho, who, null);
    setRepaid(false);
    setTimeline(null);
    setTxs({});
    setFailed(null);
    setAmountStr("");
  };

  const err = (n: number) => (failed?.n === n ? failed.msg : null);

  return (
    <div className="dm-b-steps">
      {free === 0n && !hasDebt && !repaid && (
        <p className="sl-note">
          Nothing to borrow until a lender deposits: the pool has no free cash right now. Have the lender deposit first, then come back here.
        </p>
      )}
      {!hasDebt && !repaid && free > 0n && (
        <p className="sl-note">
          Borrowing the free cash makes the pool run dry. That is the moment a lender who asks to withdraw joins the queue instead of being paid on the
          spot.
        </p>
      )}

      <ol className="dm-steps">
        <StepRow
          n={1}
          title="Get demo collateral"
          hint={`Anyone can mint this test token. About ${col(reqCol)} mCOL covers borrowing ${usd(target)} mUSD at the market's 86% limit.`}
          state={stateOf(0)}
          tx={txs[1]}
          action="Mint collateral"
          busyLabel="Minting…"
          onAction={mint}
          error={err(1)}
        />
        <StepRow
          n={2}
          title="Let Morpho take the collateral"
          hint="An approval, so Morpho can pull the collateral from your wallet."
          state={stateOf(1)}
          tx={txs[2]}
          action="Approve"
          busyLabel="Approving…"
          onAction={approveCol}
          error={err(2)}
        />
        <StepRow
          n={3}
          title="Supply the collateral to Morpho"
          hint="Morpho locks it against your loan."
          state={stateOf(2)}
          tx={txs[3]}
          action="Supply collateral"
          busyLabel="Supplying…"
          onAction={supply}
          error={err(3)}
        >
          {!hasDebt && !repaid && free > 0n && (
            <label className="dm-b-amount">
              Amount to borrow (mUSD)
              <input
                inputMode="decimal"
                placeholder={usd(free)}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={busy !== null || data.posCollateral > 0n}
              />
            </label>
          )}
        </StepRow>
        <StepRow
          n={4}
          title="Borrow the pool's free cash"
          hint={`You receive ${usd(target)} mUSD straight from the Morpho market. Nothing about Sluice is called.`}
          state={stateOf(3)}
          tx={txs[4]}
          action={`Borrow ${usd(target)} mUSD`}
          busyLabel="Borrowing…"
          onAction={borrow}
          error={err(4)}
        />
        <StepRow
          n={5}
          title="Let Morpho take your repayment"
          hint="An approval for the mUSD you are about to pay back."
          state={stateOf(4)}
          tx={txs[5]}
          action="Approve"
          busyLabel="Approving…"
          onAction={approveUsd}
          error={err(5)}
        />
        <StepRow
          n={6}
          title="Repay the loan on Morpho"
          hint="The one click that matters. Cash returns to the pool; if a lender is waiting, Reactive notices and pays them on its own."
          state={stateOf(5)}
          tx={txs[6]}
          action={`Repay ${usd(data.debt)} mUSD`}
          busyLabel="Repaying…"
          onAction={repay}
          error={err(6)}
        />
      </ol>

      {timeline && <SettlementTimeline key={timeline.repayTx} t={timeline} addresses={addresses} />}
      {repaid && !hasDebt && (
        <button className="dm-link" onClick={startOver}>
          Borrow again
        </button>
      )}
    </div>
  );
}

interface Seen {
  reactive?: { tx: Hex; ts: number };
  callback?: { tx: Hex; ts: number; from: string; paid: bigint; firstId: bigint; count: number };
}

/**
 * What the repayment set off, found on-chain by its trace id (the repay transaction's hash): Reactive's reaction on
 * Lasna, then the callback Reactive's signer sent to the vault on Base, then the payout. Times come from block
 * timestamps, which have one-second resolution and come from different chains' clocks, so small gaps are approximate.
 */
function SettlementTimeline({ t, addresses }: { t: Timeline; addresses: Record<string, string> }) {
  const [seen, setSeen] = useState<Seen>({});
  const [nobody, setNobody] = useState(false);
  const [seenMs, setSeenMs] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const trace = BigInt(t.repayTx);
    const vault = addresses.sluiceVault as Address;
    const reactive = addresses.sluiceReactive as Address;
    const started = Date.now();
    const cur: Seen = {};
    let callbackAt = 0;

    (async () => {
      while (!stop && Date.now() - started < 60_000) {
        try {
          if (!cur.reactive) {
            const latest = await clients.lasna.getBlockNumber();
            const from = latest - t.lasnaFrom > 290n ? latest - 290n : t.lasnaFrom;
            const logs = await clients.lasna.getLogs({ address: reactive, event: pullRequested, args: { traceId: trace }, fromBlock: from, toBlock: latest });
            if (logs[0]) {
              const blk = await clients.lasna.getBlock({ blockNumber: logs[0].blockNumber });
              cur.reactive = { tx: logs[0].transactionHash, ts: Number(blk.timestamp) };
            }
          }
          if (!cur.callback) {
            const latest = await clients.base.getBlockNumber();
            const to = latest < t.repayBlock + 190n ? latest : t.repayBlock + 190n;
            const logs = await clients.base.getContractEvents({ address: vault, abi: vaultAbi, eventName: "WithdrawSettled", fromBlock: t.repayBlock, toBlock: to });
            const hits = logs.filter((l) => l.args.traceId === trace);
            if (hits.length) {
              const first = hits[0];
              const [tx, blk] = await Promise.all([
                clients.base.getTransaction({ hash: first.transactionHash! }),
                clients.base.getBlock({ blockNumber: first.blockNumber! }),
              ]);
              cur.callback = {
                tx: first.transactionHash!,
                ts: Number(blk.timestamp),
                from: tx.from,
                paid: hits.reduce((s, l) => s + (l.args.paid ?? 0n), 0n),
                firstId: first.args.requestId ?? 0n,
                count: hits.length,
              };
              setSeenMs(Date.now() - t.minedAtMs);
              callbackAt = Date.now();
            }
          }
        } catch {
          /* public RPCs blip; try again */
        }
        if (!stop) setSeen({ ...cur });
        // The callback on Base can be seen before Lasna's public RPC returns Reactive's own log: keep looking for it a while.
        if (cur.callback && (cur.reactive || Date.now() - callbackAt > 20_000)) return;
        if (!cur.reactive && Date.now() - started > 15_000) setNobody(true);
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      stop = true;
    };
  }, [t, addresses]);

  const gap = (to: number | undefined) => (to === undefined ? "" : `+${Math.max(0, to - t.repayTs)} s`);
  const { reactive, callback } = seen;

  return (
    <div className="dm-b-tl" aria-live="polite">
      <h4>What your repayment set off</h4>
      <ol>
        <li className="on">
          <span className="dm-b-dot" />
          <div>
            <b>Repay mined on Base</b> <span className="dm-b-t">+0 s</span>
            <a className="sl-link sl-mono" href={txUrl("base", t.repayTx)} target="_blank" rel="noreferrer">
              {short(t.repayTx, 8, 6)} ↗
            </a>
          </div>
        </li>
        <li className={reactive ? "on" : ""}>
          <span className="dm-b-dot" />
          <div>
            <b>Reactive noticed it on Lasna</b> <span className="dm-b-t">{gap(reactive?.ts)}</span>
            {reactive ? (
              <a className="sl-link sl-mono" href={txUrl("lasna", reactive.tx)} target="_blank" rel="noreferrer">
                {short(reactive.tx, 8, 6)} ↗
              </a>
            ) : (
              <span className="dm-b-wait">{nobody ? "Nothing yet" : "Watching…"}</span>
            )}
          </div>
        </li>
        <li className={callback ? "on" : ""}>
          <span className="dm-b-dot" />
          <div>
            <b>Reactive&apos;s signer called the vault</b> <span className="dm-b-t">{gap(callback?.ts)}</span>
            {callback ? (
              <>
                <a className="sl-link sl-mono" href={txUrl("base", callback.tx)} target="_blank" rel="noreferrer">
                  {short(callback.tx, 8, 6)} ↗
                </a>
                <span className={isReactiveSigner(callback.from) ? "dm-b-ok" : ""}>
                  {isReactiveSigner(callback.from) ? "✓ sent by Reactive's signer, not by us or you" : `sent by ${short(callback.from, 4, 4)}`}
                </span>
              </>
            ) : (
              <span className="dm-b-wait">{nobody ? "Nothing yet" : "Waiting…"}</span>
            )}
          </div>
        </li>
        <li className={callback ? "on" : ""}>
          <span className="dm-b-dot" />
          <div>
            <b>The lender was paid</b>
            {callback ? (
              <span>
                {usd(callback.paid)} mUSD to request #{callback.firstId.toString()}
                {callback.count > 1 ? ` and ${callback.count - 1} more` : ""}
              </span>
            ) : (
              <span className="dm-b-wait">{nobody ? "" : "…"}</span>
            )}
          </div>
        </li>
      </ol>
      {callback && (
        <p className="dm-b-sum">
          {Math.max(0, callback.ts - t.repayTs)} s between your repayment and the payout by block timestamps
          {seenMs !== null && !t.restored ? `; your browser saw it ${(seenMs / 1000).toFixed(1)} s after your transaction was mined` : ""}. Block timestamps have
          one-second resolution.
        </p>
      )}
      {nobody && !callback && !reactive && (
        <p className="sl-note">Nobody was waiting: the cash simply returned to the pool. (Reactive only acts when someone is queued.)</p>
      )}
    </div>
  );
}
