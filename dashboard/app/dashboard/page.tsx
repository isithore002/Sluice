"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BatchDemo } from "../../components/dashboard/BatchDemo";
import { CaseStudyView } from "../../components/dashboard/CaseStudy";
import { ContractsTable } from "../../components/dashboard/ContractsTable";
import { EventFeed } from "../../components/dashboard/EventFeed";
import { ExampleLoops } from "../../components/dashboard/ExampleLoops";
import { LatencyTable } from "../../components/dashboard/LatencySection";
import { CallbackBadge, CallbackNotice } from "../../components/dashboard/CallbackHealth";
import { FundingStatus } from "../../components/dashboard/LiveCards";
import { DemoEvidence } from "../../components/demo/DemoEvidence";
import { TreasuryView } from "../../components/demo/TreasuryView";
import { RaceReplay } from "../../components/dashboard/RaceReplay";
import { secs } from "../../components/dashboard/format";
import { Reveal } from "../../components/Motion";
import { RaceChart } from "../../components/RaceChart";
import { SiteShell } from "../../components/SiteShell";
import { loadManifest, type Manifest } from "../../lib/manifest";
import { useCallbackHealth } from "../../lib/useCallbackHealth";
import { useLive } from "../../lib/useLive";
import "./dashboard.css";

// wagmi and RainbowKit load only with these panels, after the page is up, so they stay out of the first-load JavaScript.
const TryItPanel = dynamic(() => import("../../components/web3/TryItPanel"), {
  ssr: false,
  loading: () => <p className="sl-note">Loading wallet options…</p>,
});

const LivePoolPanel = dynamic(() => import("../../components/web3/LivePoolPanel"), {
  ssr: false,
  // Roughly the finished height of the pool, queue and Reactive panels, so the page doesn't jump when they appear.
  loading: () => (
    <div style={{ minHeight: 640 }} aria-busy="true">
      <p className="sl-note">Loading the live pool…</p>
    </div>
  ),
});

const DemoStagePanel = dynamic(() => import("../../components/web3/DemoStagePanel"), {
  ssr: false,
  // Reserve roughly the finished height, so the page below doesn't jump when the demo appears.
  loading: () => (
    <div style={{ minHeight: 760 }} aria-busy="true">
      <p className="sl-note">Loading the live demo…</p>
    </div>
  ),
});

const GITHUB = "https://github.com/isithore002/Sluice";

/**
 * One collapsed item of the deep dive. Its content mounts only once opened, so the heavy extras (replay, event feed,
 * wallet code) cost nothing until a judge asks for them. A link to its #id opens it.
 */
function Deep({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [id]);
  return (
    <details id={id} className="dash-deep-item" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>{title}</b>
        <span>{hint}</span>
      </summary>
      {open && <div className="dash-deep-body">{children}</div>}
    </details>
  );
}

export default function Dashboard() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setLoadError(String(e)));
  }, []);

  const addresses = useMemo(() => (manifest?.deployed ? manifest.addresses : null), [manifest]);
  const { state, events, error, updatedAt } = useLive(addresses);
  const health = useCallbackHealth(Boolean(addresses));

  const summary = manifest?.summary ?? null;
  const race = summary?.race ?? [];
  const replay = manifest?.raceReplay ?? null;
  const batch = manifest?.batch ?? null;
  const caseStudy = manifest?.caseStudy ?? null;
  const demoRun = manifest?.demoRun ?? null;
  const hasLatency = !!summary && (summary.flowB.succeeded > 0 || summary.flowC.succeeded > 0);
  const hasLoops = !!summary && !!(summary.flowB.example || summary.flowC.example);

  return (
    <SiteShell
      badge="live"
      links={[
        { href: "#treasury", label: "Treasury" },
        { href: "#demo", label: "Live demo" },
        { href: "#evidence", label: "Evidence" },
        ...(hasLatency ? [{ href: "#latency", label: "Latency" }] : []),
        ...(hasLoops ? [{ href: "#crosschain", label: "Cross-chain" }] : []),
        { href: "#deep", label: "Deep dive" },
        { href: "#contracts", label: "Contracts" },
        { href: GITHUB, label: "GitHub" },
      ]}
      cta={{ href: "/", label: "Home" }}
    >
      <main className="dash">
        <header className="dash-head sl-wrap" data-ascii-avoid="0.85">
          <div className="dash-head-main">
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
              Real contracts on Base Sepolia, Reactive Lasna and Unichain Sepolia. Everything below is read straight from public RPCs, and every measurement links to
              the transactions behind it.
            </p>
          </div>
          <aside className="sl-card dash-status sl-rise" style={{ animationDelay: "0.44s" }} aria-label="Network status">
            <h3>Status</h3>
            <ul>
              <li>
                <span>Networks</span>
                <div className="sl-chips">
                  <span className="sl-chip base">Base Sepolia</span>
                  <span className="sl-chip lasna">Reactive Lasna</span>
                  <span className="sl-chip uni">Unichain Sepolia</span>
                </div>
              </li>
              {manifest?.deployed && (
                <li>
                  <span>Contracts</span>
                  <FundingStatus state={state} />
                </li>
              )}
              {manifest?.deployed && (
                <li>
                  <span>Callbacks</span>
                  <CallbackBadge health={health} />
                </li>
              )}
              <li>
                <span>Updated</span>
                <b className="upd">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "loading…"}</b>
              </li>
            </ul>
          </aside>
        </header>

        <nav className="dash-jump sl-wrap" aria-label="Sections">
          {[
            { href: "#treasury", label: "Treasury" },
            { href: "#demo", label: "Live demo" },
            { href: "#evidence", label: "Evidence" },
            ...(hasLatency ? [{ href: "#latency", label: "Latency" }] : []),
            ...(hasLoops ? [{ href: "#crosschain", label: "Cross-chain" }] : []),
            { href: "#deep", label: "Deep dive" },
            { href: "#contracts", label: "Contracts" },
          ].map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        {manifest?.deployed && addresses && (
          <section id="treasury" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
            <TreasuryView addresses={manifest.addresses} state={state} events={events} />
            <h3 className="dash-subhead">The pool and the queue, live</h3>
            <LivePoolPanel addresses={manifest.addresses} state={state} events={events} />
          </section>
        )}

        <section id="demo" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
          <p className="sl-kicker">Live demo</p>
          <h2>A lender, a borrower, and a queue that settles itself</h2>
          {!manifest && !loadError && <p className="sl-note">Loading…</p>}
          {loadError && <p className="sl-err">{loadError}</p>}
          {manifest && !manifest.deployed && <div className="sl-banner">Not deployed yet. Run scripts/deploy.sh, then rebuild the dashboard.</div>}
          {error && <p className="sl-err">{error}</p>}
          {manifest?.deployed && (
            <Reveal>
              <CallbackNotice health={health} />
              <p className="dash-intro">
                Two wallets, two roles. The lender deposits and asks for money back; the borrower borrows from the Morpho market and repays it. Nobody calls
                Sluice to settle: Reactive sees the repayment and pays the queue. Every button is a real transaction on Base Sepolia with free test tokens, and the
                pool above is read from the chain.
              </p>
              <DemoStagePanel addresses={manifest.addresses} state={state} events={events} />
            </Reveal>
          )}
        </section>

        {manifest?.deployed && (batch || race.length > 0 || demoRun) && (
          <section id="evidence" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Evidence</p>
              <h2>A full run, the 40-ticket run, and the race</h2>
              <p className="dash-intro">Runs from earlier on the same testnets, kept with every transaction hash so they stay verifiable after the live view moves on. They are recorded, not re-created here.</p>
              <DemoEvidence batch={batch} race={race} demoRun={demoRun} />
            </Reveal>
          </section>
        )}

        {hasLatency && summary && (
          <section id="latency" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Measured</p>
              <h2>Latency of each live loop</h2>
              <p className="dash-intro">Live loops on testnet, traced end to end by the origin transaction hash.</p>
              <LatencyTable summary={summary} />
            </Reveal>
          </section>
        )}

        {hasLoops && summary && (
          <section id="crosschain" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Cross-chain</p>
              <h2>One verified loop per flow</h2>
              <p className="dash-intro">
                When Morpho can&apos;t cover the queue, Sluice pays from spare credit on Unichain: the reserve on Base fronts the payout, then Unichain reimburses exactly
                what was sent. Open each transaction on its explorer and follow the chain of events yourself.
              </p>
              <ExampleLoops summary={summary} />
            </Reveal>
          </section>
        )}

        <section id="deep" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
          <p className="sl-kicker">Deep dive</p>
          <h2>For the curious</h2>
          <p className="dash-intro">Everything behind the evidence above. Each item opens on demand.</p>
          <div className="dash-deep">
            {race.length > 0 && (
              <Deep id="replay" title="The race, round by round" hint="Chart, full table, and a replay of each recorded round with its transactions">
                <p className="dash-intro">
                  A competitor bot (one we run ourselves, from a lender wallet in the same market) tries to grab freed liquidity a few seconds after each repayment.
                  Share captured by the queue, at Omni speed vs the same system slowed to legacy-like speed.
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
                    The legacy network no longer exists (Lasna and Reactive Mainnet both moved to Omni in October 2026), so the ~legacy rows reproduce its ~7 s blocks on
                    Omni, using Reactive&apos;s own figure. A competitor in the same block beats any reactive system.
                  </p>
                </div>
                {replay && replay.rounds.length > 0 && (
                  <div className="dash-gap">
                    <RaceReplay rounds={replay.rounds} cells={race} />
                  </div>
                )}
              </Deep>
            )}

            {batch && (
              <Deep id="batch" title={`The ${batch.n}-withdrawal run, replayable`} hint="Which callback paid which request, with gas per callback">
                <p className="dash-intro">
                  A callback pays at most {batch.cap} queued withdrawals so its gas stays bounded. When one repayment frees cash for more than that, Reactive sees the vault
                  still holds payable cash and schedules the next batch itself. Nobody deposits again and nobody calls anything.
                </p>
                <BatchDemo batch={batch} />
              </Deep>
            )}

            {manifest?.deployed && (
              <Deep id="events" title="Live events across the three chains" hint="Every callback shows who sent it: Reactive's signer, not a keeper bot">
                <div className="sl-card">
                  <EventFeed events={events} />
                </div>
              </Deep>
            )}

            {caseStudy && (
              <Deep
                id="case"
                title={`The one loop that didn't count (${caseStudy.counts.recorded} of ${caseStudy.counts.attempted})`}
                hint="It completed on-chain; what failed was our test harness's cleanup"
              >
                <p className="dash-intro">
                  {caseStudy.counts.recorded} of {caseStudy.counts.attempted} cross-chain loops are in the latency numbers. The other one completed too: the user was paid and
                  the relayer reimbursed. What failed was the test harness&apos;s own cleanup. Reconstructed step by step from chain data.
                </p>
                <CaseStudyView study={caseStudy} />
              </Deep>
            )}

            {manifest?.deployed && manifest.addresses.oneClickRepay && (
              <Deep id="tryit" title="One-click repay shortcut" hint="Demo helper for a single wallet; needs armed tickets (npm run arm)">
                <p className="dash-intro">
                  A shortcut for a visitor with one wallet: one transaction repays part of the demo borrower&apos;s loan through a small helper contract (demo scaffolding, not
                  part of Sluice). You never call Sluice: Reactive sees the cash come back and pays the next withdrawal in the queue on its own. It only has something to
                  pay when tickets are queued.
                </p>
                <TryItPanel addresses={manifest.addresses} queued={state?.queued ?? null} />
              </Deep>
            )}
          </div>
        </section>

        {manifest?.deployed && (
          <section id="contracts" className="sl-section tight sl-wrap dash-sec" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Deployed</p>
              <h2>Contracts</h2>
              <p className="dash-intro">
                Our contracts are source-verified on Sourcify with an exact match (links in the README). Morpho Blue is a third-party deployment; the demo&apos;s token,
                collateral and oracle are test fixtures we deployed.
              </p>
              <ContractsTable addresses={manifest.addresses} />
            </Reveal>
          </section>
        )}
      </main>
    </SiteShell>
  );
}
