"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AsciiScene } from "../components/AsciiScene";
import { CountUp, Reveal } from "../components/Motion";
import { QueueRun } from "../components/QueueRun";
import { RaceChart } from "../components/RaceChart";
import { SiteShell } from "../components/SiteShell";
import CursorGrid from "../components/ui/CursorGrid";
import MagicBento from "../components/ui/MagicBento";
import PixelCard from "../components/ui/PixelCard";
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

const STEPS = [
  {
    tag: "Event",
    title: "Something frees liquidity",
    body: "A borrower repays in a Morpho market we don't control, a deposit lands, or another chain has spare credit.",
  },
  {
    tag: "Reaction",
    title: "Reactive decides, in about a second",
    body: "SluiceReactive sees the event on Lasna and tells the vault to pull from Morpho, or the reserve to front the shortfall.",
  },
  {
    tag: "Callback",
    title: "The queue is paid in order",
    body: "First come, first served, with partial fills at the head. Missed events heal through retries, and bad debt halts cross-chain fronting.",
  },
];

/** The pixel colours for the three flow cards: tide blue, never the warm brass (that is reserved for "paid"). */
const FLOW_PIXELS = ["#f4f4f5", "#e8e8ec", "#c8c8ce"];

function Tile({ big, label, note, href, linkLabel }: { big: ReactNode; label: string; note?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="lp-tile">
      <div className="lp-tile-big">{big}</div>
      <p className="lp-tile-label">{label}</p>
      {note && <p className="lp-tile-note">{note}</p>}
      {href && (
        <a className="lp-tile-link sl-link" href={href}>
          {linkLabel}
        </a>
      )}
    </div>
  );
}

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

  // The measured claims, as one glass bento. Each tile exists only if its data does.
  const tiles: { colSpan?: number; rowSpan?: number; content: ReactNode }[] = [];
  if (s && s.flowB.succeeded > 0) {
    tiles.push({
      colSpan: 2,
      rowSpan: 2,
      content: (
        <Tile
          big={<CountUp to={s.flowB.totalWallMs.median / 1000} decimals={2} suffix=" s" />}
          label="from a Morpho repayment to the queue being paid"
          note={`Median over ${s.flowB.succeeded} of ${s.flowB.attempted} live loops that all settled. 95th percentile ${(s.flowB.totalWallMs.p95 / 1000).toFixed(2)} s. Every loop is traced by its origin transaction hash.`}
          href={`${BASE}/dashboard/#latency`}
          linkLabel="See the latency table"
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
      content: (
        <Tile
          big={
            <>
              <CountUp to={native4.meanCapture * 100} suffix="%" /> <span className="lp-vs">against</span> {Math.round(legacy4.meanCapture * 100)}%
            </>
          }
          label="of freed liquidity captured by the queue, against a competitor that reacts after 4 s"
          note={`At Omni speed, then the same system slowed by ${legacy4.delayBlocks} Lasna blocks to mimic the legacy network.`}
          href={`${BASE}/dashboard/#replay`}
          linkLabel="Replay the race"
        />
      ),
    });
  }
  if (lifeline) {
    tiles.push({
      content: (
        <Tile
          big={<>about {lifeline.remote.blacklistToRevivedSecondsApprox} s</>}
          label="to revive a contract Omni silently stopped for debt"
          note="Measured on Lasna and across chains, on probe contracts."
          href={`${BASE}/dashboard/#lifeline`}
          linkLabel="See Lifeline"
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
        { href: "#how", label: "How it works" },
        { href: "#proof-numbers", label: "Measured" },
        { href: "#why", label: "Why Omni" },
        { href: "#proof", label: "Try it" },
        { href: GITHUB, label: "GitHub" },
      ]}
      cta={{ href: "/dashboard", label: "Live dashboard" }}
    >
      <main id="top">
        <div className="lp-band">
          <CursorGrid
            className="lp-grid"
            cellSize={56}
            color="#e8e8ec"
            gridColor="#b4b4bc"
            gridOpacity={0.04}
            fillOpacity={0.07}
            lineWidth={1}
            radius={170}
            spotlight={0.5}
            edgeFade={0}
            holdTime={350}
            fadeDuration={900}
          />
          <div className="lp-hero sl-wrap">
            <div className="lp-copy">
              <h1 className="sl-title lp-title sl-rise">Withdrawal queues that settle themselves.</h1>
              <p className="lp-lede sl-rise" style={{ animationDelay: "0.12s" }}>
                When liquidity comes back anywhere (a repayment in a Morpho market we don&apos;t control, or spare credit on another chain), a
                Reactive contract pays the queue in order within a couple of seconds. No manager. No keeper bot.
              </p>
              <div className="sl-cta sl-rise" style={{ animationDelay: "0.22s" }}>
                <Link href="/dashboard" className="sl-btn primary">
                  Open the live dashboard
                </Link>
                <a href={GITHUB} target="_blank" rel="noreferrer" className="sl-btn">
                  Read the source
                </a>
              </div>
              <div className="sl-chips sl-rise" style={{ animationDelay: "0.3s" }}>
                <span className="sl-chip base">Base Sepolia</span>
                <span className="sl-chip lasna">Reactive Lasna</span>
                <span className="sl-chip uni">Unichain Sepolia</span>
              </div>
            </div>

            <div className="lp-stage sl-rise" style={{ animationDelay: "0.2s" }}>
              <div className="lp-scene">
                <AsciiScene />
              </div>
            </div>
          </div>
        </div>

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

        <section id="how" className="sl-section sl-wrap">
          <Reveal>
            <h2>Liquidity returns. The queue moves.</h2>
          </Reveal>
          <div className="lp-flow">
            {STEPS.map((st, i) => (
              <Reveal key={st.title} delay={i * 90}>
                <PixelCard colors={FLOW_PIXELS} gap={8} speed={22} pixelSize={2.4} glow={0.3} glowColor="#c8c8ce" fade={0.35} intro={false} radius={20} theme="dark" className="lp-pixel">
                  <div className="lp-pixel-body">
                    <span className="sl-tag">{st.tag}</span>
                    <div>
                      <h3>{st.title}</h3>
                      <p>{st.body}</p>
                    </div>
                  </div>
                </PixelCard>
              </Reveal>
            ))}
          </div>
        </section>

        {tiles.length > 0 && (
          <section id="proof-numbers" className="sl-section sl-wrap">
            <Reveal>
              <h2>What we measured, and what we don&apos;t claim</h2>
              <p className="sl-p">Live testnet loops, traced end to end by the origin transaction hash. Every figure links to the transactions behind it.</p>
            </Reveal>
            <div className="lp-bento">
              <MagicBento
                items={tiles}
                columns={4}
                rowHeight={214}
                gap={14}
                radius={22}
                theme="dark"
                glowColor="#e8e8ec"
                spotlightRadius={320}
                enableTilt
                enableMagnetism
                enableStars
                particleCount={18}
                clickEffect
                textAutoHide={false}
                style={
                  {
                    "--mb-surface": "linear-gradient(180deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0.035) 100%), rgba(16, 16, 18, 0.6)",
                    "--mb-edge": "rgba(255, 255, 255, 0.1)",
                    "--mb-highlight": "rgba(255, 255, 255, 0.07)",
                    "--mb-ink": "#eaeef6",
                    "--mb-muted": "#a7b1c5",
                  } as React.CSSProperties
                }
              />
            </div>
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
            <div className="lp-bento lp-deeper">
              <MagicBento
                items={deeper.map((d) => ({
                  href: d.href,
                  content: (
                    <Tile big={<span className="lp-deeper-title">{d.title}</span>} label={d.body} />
                  ),
                }))}
                columns={3}
                rowHeight={176}
                gap={14}
                radius={22}
                theme="dark"
                glowColor="#e8e8ec"
                spotlightRadius={300}
                clickEffect={false}
                textAutoHide={false}
                style={
                  {
                    "--mb-surface": "linear-gradient(180deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0.035) 100%), rgba(16, 16, 18, 0.6)",
                    "--mb-edge": "rgba(255, 255, 255, 0.1)",
                    "--mb-highlight": "rgba(255, 255, 255, 0.07)",
                    "--mb-ink": "#eaeef6",
                    "--mb-muted": "#a7b1c5",
                  } as React.CSSProperties
                }
              />
            </div>
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
