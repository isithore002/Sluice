"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { numberToHex, parseEventLogs, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { clients, txUrl } from "../../lib/config";
import { tokenAbi, vaultUserAbi } from "../../lib/demo";
import { isReactiveSigner, secs, short, usd } from "../dashboard/format";
import { StepRow, type StepState } from "./StepRow";
import { useRoles } from "./roles";
import { WalletGate, errText } from "./WalletGate";
import "./demo-lender.css";

/** What the lender's browser remembers about the withdrawal it asked for (the chain is the source of truth for the rest). */
type Saved =
  | { kind: "ticket"; id: string; assets: string; block: string; tx: Hex; at: number }
  | { kind: "instant"; assets: string; tx: Hex };

interface Reads {
  bal: bigint;
  allowance: bigint;
  shares: bigint;
  pendingTotal: bigint;
  queueLength: bigint;
  head: bigint;
  /** The saved ticket's remaining amount, or null when there is no ticket. */
  remaining: bigint | null;
}

interface Settled {
  paid: bigint;
  callback: Hex;
  sender: string;
  traceId: bigint;
  /** Seconds between the borrower's repay block and the payout block (block timestamps, 1 s resolution), if known. */
  afterRepaySecs: number | null;
  repayTx: Hex | null;
  viaDeposit: boolean;
}

const POLL_MS = 3000;
const WINDOW = 189n; // Base Sepolia's public RPC serves at most 200 blocks of logs per query

const storeKey = (vault: string, a: string) => `sluice-demo-lender-withdrawal-${vault.toLowerCase()}-${a.toLowerCase()}`;
function load(vault: string, a: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(storeKey(vault, a));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(vault: string, a: string, s: Saved | null) {
  try {
    if (s) window.localStorage.setItem(storeKey(vault, a), JSON.stringify(s));
    else window.localStorage.removeItem(storeKey(vault, a));
  } catch {
    /* the page just won't remember it */
  }
}

/** Finds the lender's own WithdrawSettled payouts for one ticket and how long after the borrower's repay they came. */
async function lookupSettlement(vault: Address, id: bigint, owner: Address, fromBlock: bigint): Promise<Settled | null> {
  const c = clients.base;
  const latest = await c.getBlockNumber();
  const logs: Awaited<ReturnType<typeof c.getContractEvents<typeof vaultUserAbi, "WithdrawSettled">>> = [];
  let from = fromBlock;
  for (let i = 0; i < 14 && from <= latest; i++) {
    const to = from + WINDOW < latest ? from + WINDOW : latest;
    logs.push(...(await c.getContractEvents({ address: vault, abi: vaultUserAbi, eventName: "WithdrawSettled", args: { requestId: id, owner }, fromBlock: from, toBlock: to })));
    if (logs.some((l) => l.args.remaining === 0n)) break;
    from = to + 1n;
  }
  if (!logs.length) return null;
  const last = logs.find((l) => l.args.remaining === 0n) ?? logs[logs.length - 1];
  const paid = logs.reduce((s, l) => s + (l.args.paid ?? 0n), 0n);
  const traceId = last.args.traceId ?? 0n;
  const cb = await c.getTransaction({ hash: last.transactionHash! });
  let afterRepaySecs: number | null = null;
  let repayTx: Hex | null = null;
  if (traceId !== 0n) {
    try {
      repayTx = numberToHex(traceId, { size: 32 });
      const rtx = await c.getTransaction({ hash: repayTx });
      const [rb, cbb] = await Promise.all([c.getBlock({ blockNumber: rtx.blockNumber! }), c.getBlock({ blockNumber: cb.blockNumber! })]);
      afterRepaySecs = Math.max(0, Number(cbb.timestamp - rb.timestamp));
    } catch {
      /* timing stays unknown */
    }
  }
  return { paid, callback: last.transactionHash!, sender: cb.from, traceId, afterRepaySecs, repayTx, viaDeposit: traceId === 0n };
}

/** The lender's recent queued withdrawal, if this browser forgot it (a few minutes of history). */
async function discoverTicket(vault: Address, owner: Address): Promise<Saved | null> {
  const c = clients.base;
  const latest = await c.getBlockNumber();
  let to = latest;
  for (let i = 0; i < 4; i++) {
    const from = to - WINDOW > 0n ? to - WINDOW : 0n;
    const logs = await c.getContractEvents({ address: vault, abi: vaultUserAbi, eventName: "WithdrawQueued", args: { owner }, fromBlock: from, toBlock: to });
    const l = logs[logs.length - 1];
    if (l) return { kind: "ticket", id: String(l.args.requestId), assets: String(l.args.assets), block: String(l.blockNumber), tx: l.transactionHash!, at: Date.now() };
    to = from - 1n;
  }
  return null;
}

export function LenderTab({ addresses }: { addresses: Record<string, string> }) {
  const { address } = useAccount();
  const { clash, remember } = useRoles("lender", address);
  const notice = clash ? (
    <p className="sl-err">
      This is the wallet you used as the <b>borrower</b>. A lender and a borrower must be different people: switch to another account in your wallet, or use
      a different browser profile.
    </p>
  ) : undefined;
  return (
    <div className="dm-l">
      <p className="sl-note dm-l-note">
        You are the <b>lender</b>. You put money in and ask for it back. You never call Reactive or Morpho: when a borrower repays, Reactive pays your ticket by
        itself.
      </p>
      <WalletGate role="Lender" notice={notice}>
        {({ address: a }) => <LenderSteps key={a} address={a} addresses={addresses} remember={remember} />}
      </WalletGate>
    </div>
  );
}

function LenderSteps({ address, addresses, remember }: { address: Address; addresses: Record<string, string>; remember: (a: Address) => void }) {
  const vault = addresses.sluiceVault as Address;
  const usdToken = addresses.mockUSD as Address;
  const { writeContractAsync } = useWriteContract();

  const [amountStr, setAmountStr] = useState("10");
  const [reads, setReads] = useState<Reads | null>(null);
  const [saved, setSaved] = useState<Saved | null>(() => load(vault, address));
  const [settled, setSettled] = useState<Settled | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<{ step: number; msg: string } | null>(null);
  const [txs, setTxs] = useState<Record<number, Hex>>({});
  const [tick, setTick] = useState(0);
  const looked = useRef<string | null>(null);

  const amount = (() => {
    const n = Number(amountStr);
    return Number.isFinite(n) && n >= 1 && n <= 100 ? BigInt(Math.round(n * 1e6)) : 0n;
  })();

  // Poll the chain: balances, allowance, the queue, and the saved ticket's remaining amount.
  useEffect(() => {
    let stopped = false;
    const c = clients.base;
    async function read() {
      try {
        const sv = saved?.kind === "ticket" ? BigInt(saved.id) : null;
        const [bal, allowance, shares, pendingTotal, queueLength, head, req] = await Promise.all([
          c.readContract({ address: usdToken, abi: tokenAbi, functionName: "balanceOf", args: [address] }),
          c.readContract({ address: usdToken, abi: tokenAbi, functionName: "allowance", args: [address, vault] }),
          c.readContract({ address: vault, abi: vaultUserAbi, functionName: "sharesOf", args: [address] }),
          c.readContract({ address: vault, abi: vaultUserAbi, functionName: "pendingTotal" }),
          c.readContract({ address: vault, abi: vaultUserAbi, functionName: "queueLength" }),
          c.readContract({ address: vault, abi: vaultUserAbi, functionName: "head" }),
          sv !== null ? c.readContract({ address: vault, abi: vaultUserAbi, functionName: "request", args: [sv] }) : Promise.resolve(null),
        ]);
        if (!stopped) setReads({ bal, allowance, shares, pendingTotal, queueLength, head, remaining: req ? req[1] : null });
      } catch {
        /* a slow public RPC: keep the last values and try again */
      }
    }
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [address, vault, usdToken, saved, tick]);

  // A browser that forgot its ticket (another profile, cleared storage) finds a recent one on-chain.
  useEffect(() => {
    if (saved) return;
    let stopped = false;
    discoverTicket(vault, address)
      .then((s) => {
        if (!stopped && s) {
          save(vault, address, s);
          setSaved(s);
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [vault, address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the ticket is fully paid, find the payout on-chain (amount, callback transaction, who sent it, how fast).
  const ticketPaid = saved?.kind === "ticket" && reads?.remaining === 0n;
  useEffect(() => {
    if (!ticketPaid || saved?.kind !== "ticket") return;
    if (looked.current === saved.id) return;
    looked.current = saved.id;
    let stopped = false;
    lookupSettlement(vault, BigInt(saved.id), address, BigInt(saved.block))
      .then((s) => {
        if (!stopped) setSettled(s);
        if (!s) looked.current = null;
      })
      .catch(() => {
        looked.current = null;
      });
    return () => {
      stopped = true;
    };
  }, [ticketPaid, saved, vault, address]);

  const run = useCallback(
    async (step: number, fn: () => Promise<void>) => {
      setErr(null);
      setBusy(step);
      remember(address);
      try {
        await fn();
      } catch (e) {
        setErr({ step, msg: errText(e) });
      } finally {
        setBusy(null);
        setTick((t) => t + 1);
      }
    },
    [address, remember],
  );

  /** Sends one transaction and waits until it is mined; throws if it reverted. */
  async function sendAndWait(step: number, send: () => Promise<Hex>) {
    const hash = await send();
    setTxs((p) => ({ ...p, [step]: hash }));
    const rc = await clients.base.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 120_000 });
    if (rc.status !== "success") throw new Error("That transaction reverted. Check the amount, or reload and try again.");
    return rc;
  }

  const mint = () =>
    run(0, async () => {
      await sendAndWait(0, () => writeContractAsync({ address: usdToken, abi: tokenAbi, functionName: "mint", args: [address, amount], chainId: baseSepolia.id }));
    });
  const approve = () =>
    run(1, async () => {
      await sendAndWait(1, () => writeContractAsync({ address: usdToken, abi: tokenAbi, functionName: "approve", args: [vault, amount], chainId: baseSepolia.id }));
    });
  const deposit = () =>
    run(2, async () => {
      await sendAndWait(2, () => writeContractAsync({ address: vault, abi: vaultUserAbi, functionName: "deposit", args: [amount], chainId: baseSepolia.id }));
    });
  const withdraw = () =>
    run(3, async () => {
      if (!reads) return;
      const assets = reads.shares;
      const rc = await sendAndWait(3, () => writeContractAsync({ address: vault, abi: vaultUserAbi, functionName: "requestWithdraw", args: [assets], chainId: baseSepolia.id }));
      const logs = parseEventLogs({ abi: vaultUserAbi, logs: rc.logs, eventName: ["WithdrawQueued", "WithdrawPaidInstantly"] }).filter(
        (l) => l.address.toLowerCase() === vault.toLowerCase(),
      );
      const q = logs.find((l) => l.eventName === "WithdrawQueued");
      let s: Saved;
      if (q && q.eventName === "WithdrawQueued") {
        s = { kind: "ticket", id: String(q.args.requestId), assets: String(q.args.assets), block: String(rc.blockNumber), tx: rc.transactionHash, at: Date.now() };
      } else {
        s = { kind: "instant", assets: String(assets), tx: rc.transactionHash };
      }
      save(vault, address, s);
      looked.current = null;
      setSettled(null);
      setSaved(s);
    });

  function startOver() {
    save(vault, address, null);
    looked.current = null;
    setSaved(null);
    setSettled(null);
    setTxs({});
    setErr(null);
    setTick((t) => t + 1);
  }

  if (!reads) return <p className="sl-note">Reading the chain…</p>;

  // Which step is next, from what the chain says (so a reload resumes where the lender left off).
  const hasPosition = reads.shares > 0n;
  const withdrawn = saved !== null;
  const stage = withdrawn ? 4 : hasPosition ? 3 : amount > 0n && reads.allowance >= amount && reads.bal >= amount ? 2 : amount > 0n && reads.bal >= amount ? 1 : 0;
  const stateOf = (i: number): StepState => (busy === i ? "busy" : err?.step === i ? "error" : i < stage ? "done" : i === stage ? "active" : "todo");
  const ticket = saved?.kind === "ticket" ? saved : null;
  const ahead = ticket && reads ? Number(BigInt(ticket.id) > reads.head ? BigInt(ticket.id) - reads.head : 0n) : 0;
  const queuedBefore = reads.pendingTotal > 0n;
  const amountEditable = stage < 3 && busy === null;

  return (
    <div className="dm-l-steps">
      <div className="dm-l-stats" aria-live="polite">
        <div>
          <span>Your mUSD</span>
          <b>{usd(reads.bal)}</b>
        </div>
        <div>
          <span>Your deposit in Sluice</span>
          <b>{usd(reads.shares)}</b>
        </div>
        <div>
          <span>Others waiting in line</span>
          <b>{usd(reads.pendingTotal)}</b>
        </div>
      </div>

      <ol className="dm-steps">
        <StepRow
          n={1}
          title="Get demo mUSD"
          hint="The demo token is open to everyone: this mints some to your wallet. It has no value."
          state={stateOf(0)}
          tx={txs[0]}
          action={`Mint ${usd(amount)} mUSD`}
          busyLabel="Minting…"
          onAction={mint}
          error={err?.msg}
        >
          <label className="dm-l-amount">
            <span>Amount (mUSD)</span>
            <input type="number" min={1} max={100} step={1} value={amountStr} disabled={!amountEditable} onChange={(e) => setAmountStr(e.target.value)} />
          </label>
          {amount === 0n && <p className="sl-note">Choose an amount between 1 and 100.</p>}
        </StepRow>
        <StepRow
          n={2}
          title="Let Sluice take your mUSD"
          hint="A normal token approval for the Sluice vault, for exactly this amount."
          state={stateOf(1)}
          tx={txs[1]}
          action="Approve"
          busyLabel="Approving…"
          onAction={approve}
          error={err?.msg}
        />
        <StepRow
          n={3}
          title="Deposit into Sluice"
          hint="The vault lends your mUSD out through the Morpho market, and you can ask for it back at any time."
          state={stateOf(2)}
          tx={txs[2]}
          action={`Deposit ${usd(amount)} mUSD`}
          busyLabel="Depositing…"
          onAction={deposit}
          error={err?.msg}
        >
          {queuedBefore && stage < 3 && (
            <p className="sl-note dm-l-warn">
              {usd(reads.pendingTotal)} mUSD is already waiting in line. First come, first served: a deposit pays those earlier tickets first, so your money
              would go to them, not into the pool.
            </p>
          )}
        </StepRow>
        <StepRow
          n={4}
          title="Ask for your money back"
          hint="The pool decides. If it has cash, you are paid on the spot. If every mUSD is lent out, you get a numbered ticket in line."
          state={stateOf(3)}
          tx={saved?.tx ?? txs[3]}
          action={hasPosition ? `Withdraw ${usd(reads.shares)} mUSD` : "Withdraw"}
          busyLabel="Asking…"
          onAction={withdraw}
          error={err?.msg}
        >
          {stage === 3 && queuedBefore && <p className="sl-note">Others are already in line, so you would join behind them.</p>}
        </StepRow>
      </ol>

      {saved?.kind === "instant" && (
        <div className="dm-l-result">
          <p className="dm-l-big">✓ Paid instantly</p>
          <p>
            The pool had cash, so {usd(BigInt(saved.assets))} mUSD came straight back to you. The queue only appears when every mUSD is lent out. To see it, the
            borrower first borrows the pool dry, then you ask for your money.
          </p>
          <button className="sl-btn small" onClick={startOver}>
            Start over
          </button>
        </div>
      )}

      {ticket && !ticketPaid && (
        <div className="dm-l-wait" aria-live="polite">
          <p className="dm-l-big">Waiting for cash. Nothing for you to do.</p>
          <div className="sl-kv">
            <span>Your ticket</span>
            <span>
              #{ticket.id} · {usd(BigInt(ticket.assets))} mUSD
            </span>
          </div>
          <div className="sl-kv">
            <span>Still owed to you</span>
            <span>{reads.remaining === null ? "…" : `${usd(reads.remaining)} mUSD`}</span>
          </div>
          <div className="sl-kv">
            <span>In front of you</span>
            <span>{ahead === 0 ? "nobody, you are next" : `${ahead} ticket${ahead === 1 ? "" : "s"}`}</span>
          </div>
          <p className="sl-note">
            The pool is fully lent out. When a borrower repays the Morpho market, cash comes back, and Reactive pays the queue in order. Your balance rises by
            itself. <a className="sl-link sl-mono" href={txUrl("base", ticket.tx)} target="_blank" rel="noreferrer">your request ↗</a>
          </p>
        </div>
      )}

      {ticket && ticketPaid && (
        <div className="dm-l-result" aria-live="polite">
          {settled ? (
            <>
              <p className="dm-l-big">{settled.viaDeposit ? "✓ Paid" : isReactiveSigner(settled.sender) ? "✓ Paid by Reactive" : "✓ Paid"}</p>
              <div className="sl-kv">
                <span>You received</span>
                <span>{usd(settled.paid)} mUSD (ticket #{ticket.id})</span>
              </div>
              <div className="sl-kv">
                <span>Payout transaction</span>
                <span>
                  <a className="sl-link sl-mono" href={txUrl("base", settled.callback)} target="_blank" rel="noreferrer">
                    {short(settled.callback, 8, 6)} ↗
                  </a>
                </span>
              </div>
              <div className="sl-kv">
                <span>Sent by</span>
                <span className={isReactiveSigner(settled.sender) ? "dm-l-ok" : ""}>
                  {isReactiveSigner(settled.sender) ? "✓ Reactive's signer, not by you and not by us" : short(settled.sender, 4, 4)}
                </span>
              </div>
              {settled.viaDeposit ? (
                <p className="sl-note">A deposit into the vault paid your ticket in the same transaction, so Reactive wasn&apos;t needed this time.</p>
              ) : (
                <>
                  <div className="sl-kv">
                    <span>Borrower&apos;s repayment</span>
                    <span>
                      {settled.repayTx ? (
                        <a className="sl-link sl-mono" href={txUrl("base", settled.repayTx)} target="_blank" rel="noreferrer">
                          {short(settled.repayTx, 8, 6)} ↗
                        </a>
                      ) : (
                        "n/a"
                      )}
                    </span>
                  </div>
                  {settled.afterRepaySecs !== null && (
                    <div className="sl-kv">
                      <span>Repayment to payout</span>
                      <span>about {secs(settled.afterRepaySecs * 1000)}</span>
                    </div>
                  )}
                  <p className="sl-note">Measured from block timestamps (1 second resolution). You didn&apos;t call anything: the borrower repaid and Reactive did the rest.</p>
                </>
              )}
            </>
          ) : (
            <p className="dm-l-big">✓ Your ticket is paid. Finding the payout transaction…</p>
          )}
          <button className="sl-btn small" onClick={startOver}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
