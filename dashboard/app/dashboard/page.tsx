"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { BatchDemo } from "../../components/dashboard/BatchDemo";
import { CaseStudyView } from "../../components/dashboard/CaseStudy";
import { ContractsTable } from "../../components/dashboard/ContractsTable";
import { EventFeed } from "../../components/dashboard/EventFeed";
import { ExampleLoops } from "../../components/dashboard/ExampleLoops";
import { LatencyTable } from "../../components/dashboard/LatencySection";
import { FundingStatus, LiveCards } from "../../components/dashboard/LiveCards";
import { RaceReplay } from "../../components/dashboard/RaceReplay";
import { secs } from "../../components/dashboard/format";
import { Reveal } from "../../components/Motion";
import { RaceChart } from "../../components/RaceChart";
import { SiteShell } from "../../components/SiteShell";
import { loadManifest, type Manifest } from "../../lib/manifest";
import { useLive } from "../../lib/useLive";
import "./dashboard.css";

// wagmi and RainbowKit load only with this panel, after the page is up, so they stay out of the first-load JavaScript.
const TryItPanel = dynamic(() => import("../../components/web3/TryItPanel"), {
  ssr: false,
  loading: () => <p className="sl-note">Loading wallet options…</p>,
});

const DemoStagePanel = dynamic(() => import("../../components/web3/DemoStagePanel"), {
  ssr: false,
  loading: () => <p className="sl-note">Loading the live demo…</p>,
});

const GITHUB = "https://github.com/isithore002/Sluice";

export default function Dashboard() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setLoadError(String(e)));
  }, []);

  const addresses = useMemo(() => (manifest?.deployed ? manifest.addresses : null), [manifest]);
  const { state, events, error, updatedAt } = useLive(addresses);

  const summary = manifest?.summary ?? null;
  const race = summary?.race ?? [];
  const replay = manifest?.raceReplay ?? null;
  const batch = manifest?.batch ?? null;
  const caseStudy = manifest?.caseStudy ?? null;
  const hasLatency = !!summary && (summary.flowB.succeeded > 0 || summary.flowC.succeeded > 0);

  return (
    <SiteShell
      badge="live"
      links={[
        { href: "#live", label: "Live state" },
        { href: "#demo", label: "Live demo" },
        { href: "#tryit", label: "Quick repay" },
        { href: "#race", label: "Race" },
        { href: "#replay", label: "Replay" },
        { href: "#batch", label: "Batch" },
        { href: "#case", label: "Case study" },
        { href: "#contracts", label: "Contracts" },
        { href: GITHUB, label: "GitHub" },
      ]}
      cta={{ href: "/", label: "Home" }}
    >
      <main className="dash">
        <header className="dash-head sl-wrap" data-ascii-avoid="0.85">
          <p className="sl-kicker sl-rise">* Live dashboard</p>
          <h1 className="sl-title">
            <span className="a sl-rise" style={{ animationDelay: "0.08s" }}>
              The queue, live.
            </span>
            <span className="b" style={{ animationDelay: "0.2s" }}>
              Every claim, verifiable.
            </span>
          </h1>
          <p className="dash-lede sl-rise" style={{ animationDelay: "0.32s" }}>
            Real contracts on Base Sepolia, Reactive Lasna and Unichain Sepolia. The state below refreshes every few seconds straight from public RPCs,
            and every measurement links to the transactions behind it.
          </p>
          <div className="dash-meta sl-rise" style={{ animationDelay: "0.44s" }}>
            <div className="sl-chips">
              <span className="sl-chip base">Base Sepolia</span>
              <span className="sl-chip lasna">Reactive Lasna</span>
              <span className="sl-chip uni">Unichain Sepolia</span>
            </div>
            {manifest?.deployed && <FundingStatus state={state} />}
            {updatedAt && <span className="upd">updated {new Date(updatedAt).toLocaleTimeString()}</span>}
          </div>
        </header>

        <section id="live" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
          <p className="sl-kicker">Live state</p>
          <h2>What the contracts hold right now</h2>
          <p className="dash-intro">Read directly from the chains. If a contract ever went into debt, the badge above would say so: callbacks stop delivering until it is funded.</p>
          {!manifest && !loadError && <p className="sl-note">Loading…</p>}
          {loadError && <p className="sl-err">{loadError}</p>}
          {manifest && !manifest.deployed && <div className="sl-banner">Not deployed yet. Run scripts/deploy.sh, then rebuild the dashboard.</div>}
          {error && <p className="sl-err">{error}</p>}
          {state && (
            <LiveCards state={state} canTry={Boolean(manifest?.deployed && manifest.addresses.oneClickRepay)} hasCase={Boolean(caseStudy)} />
          )}
        </section>

        {manifest?.deployed && (
          <section id="demo" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Live demo</p>
              <h2>A lender, a borrower, and a queue that settles itself</h2>
              <p className="dash-intro">
                Two wallets, two roles. The lender deposits and asks for money back; the borrower borrows from the Morpho market and repays it. Nobody calls
                Sluice to settle: Reactive sees the repayment and pays the queue. Every button is a real transaction, and the pool below is read from the chain.
              </p>
              <DemoStagePanel addresses={manifest.addresses} state={state} events={events} />
            </Reveal>
          </section>
        )}

        {manifest?.deployed && manifest.addresses.oneClickRepay && (
          <section id="tryit" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Quick repay</p>
              <h2>Shortcut: one click repays the demo loan</h2>
              <p className="dash-intro">
                Don&apos;t take our wallets&apos; word for it. Repay part of the demo borrower&apos;s loan from your own wallet. You never call Sluice: Reactive
                sees the cash come back and pays the next withdrawal in the queue on its own, usually within two seconds. Nothing here is simulated: it
                runs on the live contracts.
              </p>
              <TryItPanel addresses={manifest.addresses} queued={state?.queued ?? null} />
            </Reveal>
          </section>
        )}

        {manifest?.deployed && (
          <section id="events" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Live events</p>
              <h2>Across the three chains</h2>
              <p className="dash-intro">Every callback shows who sent it. For Sluice that is Reactive&apos;s signer, not a keeper bot.</p>
              <div className="sl-card">
                <EventFeed events={events} />
              </div>
            </Reveal>
          </section>
        )}

        {race.length > 0 && (
          <section id="race" className="sl-section sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Why Omni</p>
              <h2>The latency race</h2>
              <p className="dash-intro">
                Freed liquidity is contested: a competitor bot tries to grab it a few seconds after each repayment (a bot we run ourselves, from a lender wallet in the same market). Share captured by the queue, at Omni speed vs the
                same system slowed to legacy-like speed.
              </p>
              <div className="sl-card">
                <RaceChart cells={race} />
                <div className="sl-scroll dash-gap">
                  <table className="sl-table">
                    <thead>
                      <tr>
                        <th>Sluice speed</th>
                        <th className="num">Competitor delay</th>
                        <th className="num">Rounds</th>
                        <th className="num">Queue captured</th>
                        <th className="num">Sluice acted (median)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {race.map((c) => (
                        <tr key={`${c.delayBlocks}-${c.competitorDelayS}`}>
                          <td>{c.delayBlocks === 0 ? "Omni native" : `+${c.delayBlocks} Lasna blocks (~legacy)`}</td>
                          <td className="num">{c.competitorDelayS} s</td>
                          <td className="num">{c.rounds}</td>
                          <td className="num">{Math.round(c.meanCapture * 100)}%</td>
                          <td className="num">{secs(c.sluiceActedMs.median)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="sl-note">
                  The legacy network no longer exists (Lasna and Reactive Mainnet both moved to Omni in October 2026), so the ~legacy rows reproduce its ~7 s blocks on Omni, using Reactive&apos;s own figure. A competitor in the same block beats any reactive system.
                </p>
              </div>
            </Reveal>
          </section>
        )}

        {replay && replay.rounds.length > 0 && (
          <section id="replay" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Interactive</p>
              <h2>Replay a recorded round</h2>
              <p className="dash-intro">
                Pick a competitor delay and one of the recorded rounds. Native Omni and the +6-block version of the same round sit side by side on one timeline:
                the repayment, Omni&apos;s reaction, the queue payout and the competitor&apos;s withdrawal, each with its explorer link.
              </p>
              <RaceReplay rounds={replay.rounds} cells={race} />
            </Reveal>
          </section>
        )}

        {hasLatency && summary && (
          <section id="latency" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Measured</p>
              <h2>Latency of each live loop</h2>
              <p className="dash-intro">Live loops on testnet, traced end to end by the origin transaction hash.</p>
              <LatencyTable summary={summary} />
            </Reveal>
          </section>
        )}

        {batch && (
          <section id="batch" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Live run</p>
              <h2>
                One repayment, {batch.n} withdrawals
              </h2>
              <p className="dash-intro">
                A callback pays at most {batch.cap} queued withdrawals so its gas stays bounded. When one repayment frees cash for more than that, Reactive sees
                the vault still holds payable cash and schedules the next batch itself. Nobody deposits again and nobody calls anything.
              </p>
              <BatchDemo batch={batch} />
            </Reveal>
          </section>
        )}

        {summary && (summary.flowB.example || summary.flowC.example) && (
          <section id="loops" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Verified</p>
              <h2>Example loops, one per flow</h2>
              <p className="dash-intro">Open each transaction on its explorer and follow the chain of events yourself.</p>
              <ExampleLoops summary={summary} />
            </Reveal>
          </section>
        )}

        {caseStudy && (
          <section id="case" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Case study</p>
              <h2>The one loop that didn&apos;t count</h2>
              <p className="dash-intro">
                {caseStudy.counts.recorded} of {caseStudy.counts.attempted} cross-chain loops are in the latency numbers. The other one completed too: the user was
                paid and the relayer reimbursed. What failed was the test harness&apos;s own cleanup. Reconstructed step by step from chain data.
              </p>
              <CaseStudyView study={caseStudy} />
            </Reveal>
          </section>
        )}

        {manifest?.deployed && (
          <section id="contracts" className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Deployed</p>
              <h2>Contracts</h2>
              <p className="dash-intro">
                Our contracts are source-verified on Sourcify with an exact match (links in the README). Morpho Blue is a third-party deployment; the demo&apos;s token,
                collateral and oracle are mocks we deployed.
              </p>
              <ContractsTable addresses={manifest.addresses} />
            </Reveal>
          </section>
        )}
      </main>
    </SiteShell>
  );
}
