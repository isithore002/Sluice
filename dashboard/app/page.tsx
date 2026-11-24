"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Intro } from "../components/Intro";
import { CountUp, Reveal } from "../components/Motion";
import { PixelGlyph } from "../components/PixelGlyph";
import { QueueRun } from "../components/QueueRun";
import { RaceChart } from "../components/RaceChart";
import { ScrollWords } from "../components/ScrollWords";
import { SiteShell } from "../components/SiteShell";
import { WorkflowGraph } from "../components/WorkflowGraph";
import { loadManifest, type Manifest } from "../lib/manifest";
import "./landing.css";

const GITHUB = "https://github.com/isithore002/Sluice";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** The outsider test (see README, "Try it yourself"): numbers from results/outsider-tryit.json. */
const OUTSIDER = {
  wallet: "0xB11bAa7D2Ec33DeC6bd223B5A3cD22294dd80e65",
  repay: "0x9131d956619a85301bb2cc8ea63597af986302a12ad5c60262003e63a0f52887",
  settlement: "0xa78d7101e01e2417bd34428cb9b361aa38593ae1ef18d54d86e0b9685a77229e",
  signer: "0xF7E866D726658F6C3F14B8EE537fe268a4D91DDb",
  paidTo: "0x1e96935e093051368a3e2F4acBF6380EB5e4Db9A",
};
const short = (h: string, a = 6, b = 4) => `${h.slice(0, a + 2)}…${h.slice(-b)}`;
const baseTx = (h: string) => `https://sepolia.basescan.org/tx/${h}`;

function Tile({ big, label, note, href, linkLabel }: { big: ReactNode; label: string; note?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="lp-tile">
      <div className="lp-tile-big">{big}</div>
      <p className="lp-tile-label">{label}</p>
      {note && <p className="lp-tile-note">{note}</p>}
      {href && <span className="lp-tile-link">{linkLabel}</span>}
    </div>
  );
}

const span = (c?: number, r?: number): CSSProperties => ({ gridColumn: c ? `span ${c}` : undefined, gridRow: r ? `span ${r}` : undefined });

export default function Landing() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch(() => {});
  }, []);

  const s = manifest?.summary ?? null;
  const batch = manifest?.batch ?? null;
  const caseStudy = manifest?.caseStudy ?? null;
  const lifeline = manifest?.lifeline ?? null;
  const race = s?.race ?? [];
  const capture = (native: boolean, delay: number) => race.find((c) => (c.delayBlocks === 0) === native && c.competitorDelayS === delay);
  const native4 = capture(true, 4);
  const legacy4 = capture(false, 4);
  const native0 = capture(true, 0);

  // The measured claims. Each tile exists only if its data does.
  const tiles: { colSpan?: number; rowSpan?: number; href?: string; content: ReactNode }[] = [];
  if (s && s.flowB.succeeded > 0) {
    tiles.push({
      colSpan: 2,
      rowSpan: 2,
      href: `${BASE}/dashboard/#latency`,
      content: (
        <Tile
          big={<CountUp to={s.flowB.totalWallMs.median / 1000} decimals={2} suffix=" s" />}
          label="from a Morpho repayment to the queue being paid"
          note={`Median over ${s.flowB.succeeded} of ${s.flowB.attempted} live loops that all settled. 95th percentile ${(s.flowB.totalWallMs.p95 / 1000).toFixed(2)} s. Every loop is traced by its origin transaction hash.`}
          href="x"
          linkLabel="See the latency table →"
        />
      ),
    });
  }
  if (batch?.ok) {
    tiles.push({
      content: (
        <Tile
          big={<CountUp to={batch.n} />}
          label="withdrawals paid by one repayment"
          note={`In ${(batch.timing.repayToQueueEmptyMs / 1000).toFixed(1)} s, first come first served, across ${batch.callbacks.length} callbacks.`}
        />
      ),
    });
  }
  if (s?.independent && s.independent.succeeded > 0) {
    tiles.push({
      content: (
        <Tile
          big={
            <>
              <CountUp to={s.independent.succeeded} /> of {s.independent.attempted}
            </>
          }
          label="settled for a user by a different wallet"
          note="The repayment, the request and the payout all involved addresses other than the deployer."
        />
      ),
    });
  }
  if (native4 && legacy4) {
    tiles.push({
      colSpan: 2,
      href: `${BASE}/dashboard/#replay`,
      content: (
        <Tile
          big={
            <>
              <CountUp to={native4.meanCapture * 100} suffix="%" /> <span className="lp-vs">against</span> {Math.round(legacy4.meanCapture * 100)}%
            </>
          }
          label="of freed liquidity captured by the queue, against a competitor that reacts after 4 s"
          note={`At Omni speed, then the same system slowed by ${legacy4.delayBlocks} Lasna blocks to mimic the legacy network.`}
          href="x"
          linkLabel="Replay the race →"
        />
      ),
    });
  }
  if (lifeline) {
    tiles.push({
      href: `${BASE}/dashboard/#lifeline`,
      content: (
        <Tile
          big={<>about {lifeline.remote.blacklistToRevivedSecondsApprox} s</>}
          label="to revive a contract Omni silently stopped for debt"
          note="Measured on Lasna and across chains, on probe contracts."
          href="x"
          linkLabel="See Lifeline →"
        />
      ),
    });
  }
  tiles.push({
    colSpan: 3,
    content: (
      <Tile
        big="Not faster than every bot"
        label="What this does not claim"
        note={`A bot acting in the same block still wins${native0 ? ` (the queue captured ${Math.round(native0.meanCapture * 100)}% against one)` : ""}, and a fast polling keeper is roughly level with Reactive. Sluice removes the bot and the operator, not the race.`}
      />
    ),
  });

  const deeper = [
    race.length > 0 && {
      href: `${BASE}/dashboard/#replay`,
      title: "Replay the latency race",
      body: "Pick any recorded round and watch the repayment, Omni's reaction, the queue payout and the competitor on one timeline.",
    },
    batch?.ok && {
      href: `${BASE}/dashboard/#batch`,
      title: `One repayment, ${batch.n} withdrawals`,
      body: `A callback pays at most ${batch.cap}. Reactive scheduled the next batch by itself, and everyone was paid in order.`,
    },
    caseStudy && {
      href: `${BASE}/dashboard/#case`,
      title: "The loop that didn't count",
      body: `${caseStudy.counts.recorded} of ${caseStudy.counts.attempted} cross-chain loops were measured. Here is exactly what happened to the other one.`,
    },
  ].filter(Boolean) as { href: string; title: string; body: string }[];

  return (
    <SiteShell
      links={[
        { href: "#top", label: "Home" },
        { href: "#how", label: "How it works" },
        { href: "#proof-numbers", label: "Measured" },
        { href: "#why", label: "Why Omni" },
        { href: "#proof", label: "Try it" },
        { href: GITHUB, label: "GitHub" },
      ]}
      cta={{ href: "/dashboard", label: "Live dashboard" }}
    >
      <main id="top">
        <Intro />

        <section className="lp-hero" aria-labelledby="lp-name">
          <div className="lp-dots" aria-hidden="true" />
          <div>
            <Reveal>
              <h1 id="lp-name" className="lp-name">
                Sluice
              </h1>
            </Reveal>
            <Reveal delay={90}>
              <p className="lp-sub">
                Withdrawal queues that settle <span className="dim">themselves.</span>
              </p>
            </Reveal>
            <Reveal delay={170}>
              <p className="lp-mono">Event-driven &amp; Keeper-free Liquidity Queues</p>
            </Reveal>
            <Reveal delay={240}>
              <div className="lp-actions">
                <Link href="/dashboard" className="sl-btn primary">
                  Open the live dashboard
                </Link>
                <a href={GITHUB} target="_blank" rel="noreferrer" className="sl-btn">
                  Read the source
                </a>
              </div>
            </Reveal>
            <Reveal delay={320}>
              <div className="lp-powered">
                <small>Powered by</small>
                <div className="lp-brands">
                  <span className="lp-brand" style={{ "--c": "#a27cff" } as CSSProperties}>
                    <PixelGlyph name="bolt" className="lp-glyph" />
                    Reactive
                  </span>
                  <span className="lp-brand">
                    <PixelGlyph name="wing" className="lp-glyph" />
                    Morpho
                  </span>
                  <span className="lp-brand">
                    <PixelGlyph name="disc" className="lp-glyph" />
                    Base
                  </span>
                  <span className="lp-brand" style={{ "--c": "#ff6ea9" } as CSSProperties}>
                    <PixelGlyph name="diamond" className="lp-glyph" />
                    Unichain
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="about" className="lp-about">
          <ScrollWords
            className="lp-statement"
            parts={[
              { t: "Sluice is a withdrawal queue that " },
              { t: "pays lenders in order, ", hl: true },
              { t: "the moment liquidity returns anywhere, with " },
              { t: "no manager and no keeper bot.", hl: true },
            ]}
          />
          <div className="lp-aside">
            <Reveal>
              <p>
                When liquidity comes back, a repayment in a Morpho market we don&apos;t control or spare credit on another chain, a Reactive contract pays
                the queue in order within a couple of seconds.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <p>
                Missed events heal through retries, and bad debt halts cross-chain fronting. Every number here comes from live testnet runs, traced by
                transaction hash.
              </p>
            </Reveal>
          </div>
        </section>

        <section id="how" className="sl-section sl-wrap">
          <div className="wf-head">
            <Reveal>
              <h2>Liquidity returns. The queue moves.</h2>
            </Reveal>
            <span className="wf-label">Protocol workflow</span>
          </div>
          <Reveal>
            <WorkflowGraph medianS={s && s.flowB.succeeded > 0 ? s.flowB.totalWallMs.median / 1000 : undefined} batch={batch?.ok ? { n: batch.n, callbacks: batch.callbacks.length } : undefined} />
          </Reveal>
        </section>

        {batch?.ok && (
          <section id="run" className="sl-section sl-wrap">
            <div className="lp-run">
              <Reveal>
                <h2>Watch one repayment pay the whole queue.</h2>
                <p className="sl-p">
                  A recorded run on Base Sepolia, replayed at real speed. Each ticket turns brass at the moment its callback landed, in the order the
                  lenders joined the queue.
                </p>
              </Reveal>
              <Reveal delay={100}>
                <QueueRun batch={batch} />
              </Reveal>
            </div>
          </section>
        )}

        {tiles.length > 0 && (
          <section id="proof-numbers" className="sl-section sl-wrap">
            <Reveal>
              <h2>What we measured, and what we don&apos;t claim</h2>
              <p className="sl-p">Live testnet loops, traced end to end by the origin transaction hash. Every figure links to the transactions behind it.</p>
            </Reveal>
            <Reveal delay={80}>
              <div className="lp-stats">
                {tiles.map((t, i) =>
                  t.href ? (
                    <a key={i} className="lp-stat" style={span(t.colSpan, t.rowSpan)} href={t.href}>
                      {t.content}
                    </a>
                  ) : (
                    <div key={i} className="lp-stat" style={span(t.colSpan, t.rowSpan)}>
                      {t.content}
                    </div>
                  ),
                )}
              </div>
            </Reveal>
          </section>
        )}

        {race.length > 0 && (
          <section id="why" className="sl-section sl-wrap">
            <div className="lp-why">
              <Reveal>
                <h2>Freed liquidity is contested.</h2>
                <p className="sl-p">
                  A competitor bot tries to grab it a few seconds after each repayment. At Omni speed the queue gets there first. The same
                  system slowed to legacy-like speed does not.
                </p>
                <ul className="lp-points">
                  {native0 && (
                    <li>
                      <b>{Math.round(native0.meanCapture * 100)}%</b> captured against a same-block competitor. Nothing reactive beats a bot that acts in the same block, and we don&apos;t claim to.
                    </li>
                  )}
                  <li>The legacy network no longer exists (Lasna and Reactive Mainnet moved to Omni in October 2026), so the legacy-like rows reproduce its roughly 7 s blocks on Omni, using Reactive&apos;s own figure.</li>
                </ul>
              </Reveal>
              <Reveal delay={100}>
                <div className="sl-card lp-chart">
                  <RaceChart cells={race} />
                </div>
              </Reveal>
            </div>
          </section>
        )}

        {deeper.length > 0 && (
          <section className="sl-section tight sl-wrap">
            <Reveal>
              <h2>Don&apos;t just read it. Replay it.</h2>
            </Reveal>
            <Reveal delay={80}>
              <div className="lp-deeper-grid">
                {deeper.map((d) => (
                  <a key={d.href} className="lp-stat" href={d.href}>
                    <Tile big={<span className="lp-deeper-title">{d.title}</span>} label={d.body} />
                  </a>
                ))}
              </div>
            </Reveal>
          </section>
        )}

        <section id="proof" className="sl-section sl-wrap">
          <Reveal>
            <div className="sl-card lp-proof">
              <div>
                <h2>Don&apos;t take our word for it.</h2>
                <p className="sl-p">
                  A fresh wallet we created for this test, which had never touched these contracts, repaid 10 mUSD in the Morpho market. The settlement that paid the queue
                  was sent by Reactive&apos;s signer, not by us. Open it, or better, try it yourself: repay part of the loan from your own wallet, and watch the
                  queue settle itself in about two seconds.
                </p>
                <div className="sl-cta">
                  <Link href="/dashboard#demo" className="sl-btn primary">
                    Try it from your wallet
                  </Link>
                  <a href={baseTx(OUTSIDER.settlement)} target="_blank" rel="noreferrer" className="sl-btn">
                    View our test settlement
                  </a>
                  <a href={`${GITHUB}#try-it-yourself`} target="_blank" rel="noreferrer" className="sl-btn">
                    Command-line steps
                  </a>
                </div>
              </div>
              <div className="lp-trace" role="group" aria-label="Trace of the outsider test">
                <div className="row">
                  <span className="k">Fresh wallet</span>
                  <span className="v">
                    <span className="hash">{short(OUTSIDER.wallet)}</span>
                    <span className="sub">3 transactions ever: mint, approve, repay</span>
                  </span>
                </div>
                <div className="row">
                  <span className="k">Repayment</span>
                  <span className="v">
                    <a className="hash" href={baseTx(OUTSIDER.repay)} target="_blank" rel="noreferrer">
                      {short(OUTSIDER.repay, 8, 4)}
                    </a>
                    <span className="sub">10 mUSD into the Morpho market on Base Sepolia</span>
                  </span>
                </div>
                <div className="row">
                  <span className="k">Settlement</span>
                  <span className="v">
                    <a className="hash" href={baseTx(OUTSIDER.settlement)} target="_blank" rel="noreferrer">
                      {short(OUTSIDER.settlement, 8, 4)}
                    </a>
                    <span className="sub">
                      sent by <span className="hash paid">{short(OUTSIDER.signer, 4, 4)}</span>, a Reactive signer
                    </span>
                  </span>
                </div>
                <div className="row">
                  <span className="k">Paid</span>
                  <span className="v">
                    10 mUSD to <span className="hash">{short(OUTSIDER.paidTo, 4, 4)}</span>
                    <span className="sub">the user waiting in the queue, with nothing left owed</span>
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </SiteShell>
  );
}
