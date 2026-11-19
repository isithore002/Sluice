"use client";

import type { LiveState } from "../../lib/useLive";
import { usd } from "./format";

/** The four live-state cards: Morpho market, withdrawal queue, cross-chain liquidity, the Reactive contract. */
export function LiveCards({ state }: { state: LiveState }) {
  const util = state.supply > 0n ? Number((state.borrow * 10000n) / state.supply) / 100 : 0;
  return (
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
          <span>Shortfall beyond Morpho</span>
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
