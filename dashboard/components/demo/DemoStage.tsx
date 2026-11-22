"use client";

import { useState } from "react";
import type { FeedEvent, LiveState } from "../../lib/useLive";
import { BorrowerTab } from "./BorrowerTab";
import { LenderTab } from "./LenderTab";
import { PoolView } from "./PoolView";
import type { Role } from "./roles";
import "./demo-stage.css";

export interface DemoStageProps {
  addresses: Record<string, string>;
  state: LiveState | null;
  events: FeedEvent[];
}

const ROLES: { id: Role; label: string; who: string }[] = [
  { id: "lender", label: "Lender", who: "Puts money in and takes it out of Sluice. Never touches Morpho or Reactive." },
  { id: "borrower", label: "Borrower", who: "Borrows from the Morpho market and repays it. Never touches Sluice." },
];

/**
 * The live product demo: two separate wallets, one per role, and a pool view that shows what both do to the pool.
 * Every button is a real transaction on Base Sepolia, and everything shown is read from the chains.
 */
export function DemoStage({ addresses, state, events }: DemoStageProps) {
  const [role, setRole] = useState<Role>("lender");
  const active = ROLES.find((r) => r.id === role)!;
  return (
    <div className="dm">
      <PoolView addresses={addresses} state={state} events={events} />

      <div className="dm-roles">
        <div className="sl-seg" role="tablist" aria-label="Choose a role">
          {ROLES.map((r) => (
            <button key={r.id} role="tab" aria-selected={role === r.id} className={role === r.id ? "on" : ""} onClick={() => setRole(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="dm-who">
          <b>{active.label}:</b> {active.who} Use a different wallet for each role.
        </p>
      </div>

      {role === "lender" ? <LenderTab addresses={addresses} /> : <BorrowerTab addresses={addresses} />}
    </div>
  );
}
