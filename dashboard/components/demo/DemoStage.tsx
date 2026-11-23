"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { FeedEvent, LiveState } from "../../lib/useLive";
import { BorrowerTab } from "./BorrowerTab";
import { LenderTab } from "./LenderTab";
import { PoolView, RoleLegend } from "./PoolView";
import type { Role } from "./roles";
import "./demo-stage.css";

export interface DemoStageProps {
  addresses: Record<string, string>;
  state: LiveState | null;
  events: FeedEvent[];
}

const ROLES: { id: Role; label: string }[] = [
  { id: "lender", label: "Lender" },
  { id: "borrower", label: "Borrower" },
];

const STORY: { who: string; what: string; reactive?: boolean }[] = [
  { who: "Lender", what: "deposits mUSD into Sluice. The vault lends it out through the Morpho market." },
  { who: "Borrower", what: "borrows all the free cash on Morpho, so the pool runs dry." },
  { who: "Lender", what: "asks for the money back. There is no cash, so they get a numbered ticket in line." },
  { who: "Borrower", what: "repays the loan on Morpho, like any borrower." },
  { who: "Reactive", what: "sees the repayment and pays the ticket by itself. Nobody calls Sluice.", reactive: true },
];

const FAUCETS = [
  { name: "Coinbase faucet", url: "https://portal.cdp.coinbase.com/products/faucet" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
];

/** What a first-time viewer needs before touching anything: the two wallets, the test setup, and the five-line story. */
function BeforeYouStart() {
  return (
    <section className="sl-card dm-start" aria-labelledby="dm-start-h">
      <h3 id="dm-start-h">Before you start</h3>
      <div className="dm-start-cols">
        <div>
          <p className="dm-start-sub">You need</p>
          <ul className="dm-start-list">
            <li>
              <b>Two wallets</b>, one per role: two accounts in MetaMask, or two browser profiles. A lender and a borrower must be different people.
            </li>
            <li>
              <b>A little Base Sepolia ETH in each</b> for gas (well under 0.0001 ETH covers a whole run):{" "}
              {FAUCETS.map((f, i) => (
                <span key={f.url}>
                  {i > 0 && " or "}
                  <a className="sl-link" href={f.url} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                </span>
              ))}
              .
            </li>
            <li>
              In <b>Phantom</b>, turn on Testnet Mode first (Settings → Developer Settings → Testnet Mode).
            </li>
          </ul>
          <p className="sl-note">
            Everything below is a real transaction on Base Sepolia. The mUSD and collateral are free test tokens that anyone can mint, and the lending market and
            its price feed are ours: it is a testnet.
          </p>
        </div>
        <div>
          <p className="dm-start-sub">What you will see</p>
          <ol className="dm-story">
            {STORY.map((s, i) => (
              <li key={i} className={s.reactive ? "reactive" : undefined}>
                <b>{s.who}</b> {s.what}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/**
 * The live product demo: two separate wallets, one per role, and a pool view that shows what both do to the pool.
 * Every button is a real transaction on Base Sepolia, and everything shown is read from the chains.
 */
export function DemoStage({ addresses, state, events }: DemoStageProps) {
  const [role, setRole] = useState<Role>("lender");
  const tabs = useRef<Record<Role, HTMLButtonElement | null>>({ lender: null, borrower: null });

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = ROLES.findIndex((r) => r.id === role);
    const next = e.key === "Home" ? 0 : e.key === "End" ? ROLES.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + ROLES.length) % ROLES.length;
    setRole(ROLES[next].id);
    tabs.current[ROLES[next].id]?.focus();
  }

  return (
    <div className="dm">
      <BeforeYouStart />

      <div className="dm-console">
        <section className="sl-card dm-actions" aria-label="Your wallet">
          <div className="dm-actions-head">
            <h3>Your turn</h3>
            <div className="sl-seg" role="tablist" aria-label="Choose a role" onKeyDown={onKey}>
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  ref={(el) => {
                    tabs.current[r.id] = el;
                  }}
                  role="tab"
                  id={`dm-tab-${r.id}`}
                  aria-selected={role === r.id}
                  aria-controls="dm-panel"
                  tabIndex={role === r.id ? 0 : -1}
                  className={role === r.id ? "on" : ""}
                  onClick={() => setRole(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel" id="dm-panel" aria-labelledby={`dm-tab-${role}`}>
            {role === "lender" ? <LenderTab addresses={addresses} /> : <BorrowerTab addresses={addresses} />}
          </div>
        </section>

        <div className="dm-live">
          <PoolView addresses={addresses} state={state} events={events} legend={false} />
        </div>
      </div>

      <details className="dm-legend">
        <summary>Who does what, and where Reactive fits in</summary>
        <RoleLegend />
      </details>
    </div>
  );
}
