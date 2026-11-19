"use client";

import type { LiveState } from "../../lib/useLive";
import { usd } from "./format";

/**
 * The four live-state cards (Morpho market, withdrawal queue, cross-chain liquidity, the Reactive contract), then one
 * plain sentence on why the queue looks the way it does, so a queue that is waiting for cash never reads as a fault.
 */
export function LiveCards({ state, canTry, hasCase }: { state: LiveState; canTry: boolean; hasCase: boolean }) {
  const util = state.supply > 0n ? Number((state.borrow * 10000n) / state.supply) / 100 : 0;
  return (
    <>
      <div className="sl-grid">
        <div className="sl-card">
          <h3>Morpho market</h3>
          <div className="sl-big">{util}% utilized</div>
          <div className="sl-meter" role="img" aria-label={`${util} percent of the market is borrowed`}>
            <div style={{ width: `${Math.min(100, util)}%` }} />
          </div>
          <div className="sl-kv">
            <span>Supplied / borrowed</span>
            <span>
              {usd(state.supply)} / {usd(state.borrow)}
            </span>
          </div>
        </div>

        <div className="sl-card">
          <h3>Withdrawal queue</h3>
          <div className="sl-big">{usd(state.pending)} mUSD</div>
          <div className="sl-kv">
            <span>Requests waiting</span>
            <span>{state.queued.toString()}</span>
          </div>
          <div className="sl-kv">
            <span>Not covered by free cash</span>
            <span>{usd(state.shortfall)}</span>
          </div>
        </div>

        <div className="sl-card">
          <h3>Cross-chain</h3>
          <div className="sl-kv">
            <span>Reserve inventory (Base)</span>
            <span>{usd(state.inventory)}</span>
          </div>
          <div className="sl-kv">
            <span>Credit (Unichain)</span>
            <span>{usd(state.credit)}</span>
          </div>
          <div className="sl-kv">
            <span>Fills opened / open</span>
            <span>
              {state.fillsOpened.toString()} / {state.fillsOpen}
            </span>
          </div>
        </div>

        <div className="sl-card">
          <h3>Reactive contract</h3>
          <div className="sl-kv">
            <span>Speed</span>
            <span>{state.delayBlocks === 0n ? "native" : `+${state.delayBlocks} blocks (race)`}</span>
          </div>
          <div className="sl-kv">
            <span>Cross-chain fronting</span>
            <span>{state.halted ? "halted" : "on"}</span>
          </div>
          <div className="sl-kv">
            <span>Pull in flight</span>
            <span>{state.pullPending ? "yes" : "no"}</span>
          </div>
        </div>
      </div>
      <QueueNote state={state} canTry={canTry} hasCase={hasCase} />
    </>
  );
}

function QueueNote({ state, canTry, hasCase }: { state: LiveState; canTry: boolean; hasCase: boolean }) {
  if (state.queued === 0n) return <p className="sl-note live-why">Nothing is waiting: every withdrawal has been paid.</p>;
  if (state.shortfall === 0n) {
    return <p className="sl-note live-why">There is cash for every waiting withdrawal, so Reactive is paying them now.</p>;
  }
  if (!state.halted) {
    return (
      <p className="sl-note live-why">
        <b>Waiting for cash.</b> Morpho can&apos;t cover these withdrawals right now, so Sluice asks its Base reserve to front them while
        Unichain has credit, and otherwise pays them in order as soon as cash comes back.
      </p>
    );
  }
  // Nobody has to act on the queue: it waits for cash, and pays itself the moment cash comes back. The demo pauses
  // cross-chain fronting (otherwise these would already be paid), and says so, because the credit is on screen.
  const dry = state.supply > 0n && state.borrow >= state.supply;
  return (
    <p className="sl-note live-why">
      <b>Waiting for cash, not for anyone to act.</b> {dry ? "Every mUSD in the Morpho market is borrowed" : "Morpho is short of free cash"}, so
      there is nothing to pay these with yet. The moment a borrower repays, Reactive pays the next one by itself
      {canTry ? (
        <>
          :{" "}
          <a className="sl-link" href="#tryit">
            repay part of the demo loan yourself
          </a>{" "}
          and watch.
        </>
      ) : (
        "."
      )}{" "}
      Cross-chain fronting is paused for this demo. With it on, Sluice would already have paid these through its cross-chain reserve
      {hasCase ? (
        <>
          , as the{" "}
          <a className="sl-link" href="#case">
            case study
          </a>{" "}
          shows.
        </>
      ) : (
        "."
      )}
    </p>
  );
}

/** Funding status: anything in debt stops working, so it is shown as words plus an icon, never colour alone. */
export function FundingStatus({ state }: { state: LiveState | null }) {
  if (!state) return <span className="sl-status warn"><span className="dot" aria-hidden="true" />reading chains…</span>;
  const anyDebt = Object.values(state.debts).some((d) => d > 0n);
  return anyDebt ? (
    <span className="sl-status bad">
      <span className="dot" aria-hidden="true" />! A contract is in debt
    </span>
  ) : (
    <span className="sl-status good">
      <span className="dot" aria-hidden="true" />✓ All contracts funded
    </span>
  );
}
