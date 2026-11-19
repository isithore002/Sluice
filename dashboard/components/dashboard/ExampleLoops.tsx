"use client";

import type { Summary } from "../../lib/manifest";

function Hop({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <a className="sl-link" href={href} target="_blank" rel="noreferrer">
        {children} ↗
      </a>
    </li>
  );
}

/** One real loop of each flow, as explorer links, so a judge can follow the chain of events themselves. */
export function ExampleLoops({ summary }: { summary: Summary }) {
  const { flowB, flowC, independent } = summary;
  return (
    <div className="sl-grid">
      {flowB.example && (
        <div className="sl-card">
          <h3>Flow B: Morpho repayment → queue paid</h3>
          <ol className="dash-hops">
            <Hop href={flowB.example.origin}>Borrower repays in Morpho (Base Sepolia)</Hop>
            <Hop href={flowB.example.reactive}>SluiceReactive reacts (Reactive Lasna)</Hop>
            <Hop href={flowB.example.callback}>Callback pays the queue (Base Sepolia)</Hop>
          </ol>
        </div>
      )}
      {flowC.example && (
        <div className="sl-card">
          <h3>Flow C: shortfall → fronted → reimbursed</h3>
          <ol className="dash-hops">
            <Hop href={flowC.example.origin}>Withdrawal queued with a shortfall (Base Sepolia)</Hop>
            <Hop href={flowC.example.reactive}>SluiceReactive reacts (Reactive Lasna)</Hop>
            <Hop href={flowC.example.front}>Reserve fronts, user paid (Base Sepolia)</Hop>
            <Hop href={flowC.example.reimburse}>Relayer reimbursed (Unichain Sepolia)</Hop>
          </ol>
        </div>
      )}
      {independent?.example && (
        <div className="sl-card">
          <h3>Independent actors: a user and an outsider</h3>
          <ol className="dash-hops">
            <Hop href={independent.example.links.queued}>Alice (a user) queues a withdrawal</Hop>
            <Hop href={independent.example.links.origin}>Bob, an outsider, repays in Morpho</Hop>
            <Hop href={independent.example.links.reactive}>SluiceReactive reacts (Lasna)</Hop>
            <Hop href={independent.example.links.callback}>Callback pays Alice</Hop>
          </ol>
          <p className="sl-note">
            {independent.succeeded}/{independent.attempted} loops with separate wallets for the user and the repayer; the deployer sent none of these
            transactions.
          </p>
        </div>
      )}
    </div>
  );
}
