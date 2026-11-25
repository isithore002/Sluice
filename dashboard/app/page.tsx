"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Intro } from "../components/Intro";
import { CountUp, Reveal } from "../components/Motion";
import { LoopHistogram } from "../components/LoopHistogram";
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
/**
 * Outside facts the page leans on. Each one was read on the linked page, and the wording and figures are the page's own:
 * CoinDesk (Apr 20, 2026): "$292 million exploit"; DeFi TVL "from $99.497 billion to $86.286 billion", a "$13.21 billion decline";
 * "Aave has lost $8.45 billion in deposits over the past 48 hours". Sentora (Nov 6, 2025): an Euler vault "reportedly reached 100%
 * utilization", which "functionally freezes withdrawals for any remaining lenders"; "spiking borrow rates above 20% APY".
 * Reactive (Nov 4, 2026): "On the previous version of Reactive Network, blocks came every ~7 seconds", and Omni has "~1s blocks and
 * instant finality". ethereum.org: ERC-7540 "extends the ERC-4626 Tokenized Vault Standard by adding support for asynchronous
 * deposit and redemption flows".
 */
const REACTIVE_POST = "https://blog.reactive.network/reactive-omni-buildathon-thirty-days-to-find-out-what-one-second-buys/";
const CONTEXT = [
  {
    stat: "$13.21B",
    hook: "When the exit door is small, everyone runs at once.",
    body: "In the 48 hours after the $292 million KelpDAO exploit, total value locked across DeFi fell from $99.5B to $86.3B. Aave alone lost $8.45B of deposits.",
    source: "CoinDesk, Apr 20, 2026",
    href: "https://www.coindesk.com/markets/2026/04/20/defi-tvl-drops-more-than-usd13-billion-in-two-days-following-kelp-dao-hack",
  },
  {
    stat: "100%",
    hook: "Fully lent out means frozen.",
    body: "In Sentora's review of the November 2025 stress, an Euler vault reportedly hit 100% utilization, which “functionally freezes withdrawals for any remaining lenders”. Borrow rates on the stressed tokens spiked above 20% APY.",
    source: "Sentora Research, Nov 6, 2025",
    href: "https://sentora.com/research/articles/defi-s-november-liquidity-crunch-causes-and-impacts",
  },
  {
    stat: "7 s → 1 s",
    hook: "Seven seconds is a long time to be in line.",
    body: "Reactive's earlier network produced a block about every 7 seconds. Reactive Omni runs on CometBFT with “~1s blocks and instant finality”. Our latency race measures what that gap is worth.",
    source: "Reactive Network, Nov 4, 2026",
    href: REACTIVE_POST,
  },
  {
    stat: "ERC-7540",
    hook: "Async vaults are a standard. Sluice makes the queue settle itself.",
    body: "ERC-7540 “extends the ERC-4626 Tokenized Vault Standard by adding support for asynchronous deposit and redemption flows”: request first, claim later. Sluice is built in that style (not a full ERC-7540 implementation), and nothing has to be called to pay its queue.",
    source: "ethereum.org, ERC-7540",
    href: "https://ethereum.org/developers/docs/standards/tokens/erc-7540/",
  },
];
const short = (h: string, a = 6, b = 4) => `${h.slice(0, a + 2)}…${h.slice(-b)}`;
const baseTx = (h: string) => `https://sepolia.basescan.org/tx/${h}`;

function Tile({ big, label, note, href, linkLabel, visual }: { big: ReactNode; label: string; note?: string; href?: string; linkLabel?: string; visual?: ReactNode }) {
  return (
    <div className="lp-tile">
      {visual && <div className="lp-tile-vis">{visual}</div>}
      <div className="lp-tile-big">{big}</div>
      <p className="lp-tile-label">{label}</p>
      {note && <p className="lp-tile-note">{note}</p>}
      {href && <span className="lp-tile-link">{linkLabel}</span>}
    </div>
  );
}

/** One keeper-baseline run: how many rounds Reactive paid first, and how many the polling keeper did. */
function KeeperBar({ k }: { k: { run: number; pollMs: number; rounds: number; keeper: number; reactive: number } }) {
  const label = `Polls every ${k.pollMs >= 1000 ? `${k.pollMs / 1000} s` : `${k.pollMs} ms`}${k.pollMs < 1000 ? ` (run ${k.run})` : ""}`;
  return (
    <div className="lp-cap">
      <div className="lp-cap-l">
        <span>{label}</span>
        <span>
          Reactive <b>{k.reactive}</b> · keeper <b>{k.keeper}</b>
        </span>
      </div>
      <div className="lp-cap-bar lp-kp-bar" role="img" aria-label={`${label}: Reactive paid first in ${k.reactive} of ${k.rounds} rounds, the keeper in ${k.keeper}`}>
        <span style={{ width: `${(k.reactive / k.rounds) * 100}%` }} />
      </div>
    </div>
  );
}

/** A two-colour bar: the share the queue captured (brass) against the share the competitor took. */
function CaptureBar({ label, queue }: { label: string; queue: number }) {
  const q = Math.max(0, Math.min(1, queue));
  return (
    <div className="lp-cap">
      <div className="lp-cap-l">
        <span>{label}</span>
        <span>
          <b>{Math.round(q * 100)}%</b> queue
        </span>
      </div>
      <div className="lp-cap-bar" role="img" aria-label={`${label}: the queue captured ${Math.round(q * 100)} percent`}>
        <span style={{ width: `${q * 100}%` }} />
      </div>
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
  const keeper = manifest?.keeperRuns ?? [];
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
          visual={s.flowB.samplesMs?.length ? <LoopHistogram samplesMs={s.flowB.samplesMs} medianMs={s.flowB.totalWallMs.median} p95Ms={s.flowB.totalWallMs.p95} /> : undefined}
          big={<CountUp to={s.flowB.totalWallMs.median / 1000} decimals={2} suffix=" s" />}
          label="from a Morpho repayment to the queue being paid"
          note={`Median over ${s.flowB.succeeded} of ${s.flowB.attempted} live loops that all settled. 95th percentile ${(s.flowB.totalWallMs.p95 / 1000).toFixed(2)}\u00a0s. Every loop is traced by its origin transaction hash.`}
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
          visual={
            <>
              <CaptureBar label="Omni native" queue={native4.meanCapture} />
              <CaptureBar label="+legacy delay" queue={legacy4.meanCapture} />
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
        visual={
          keeper.length > 0 ? (
            <>
              <div className="lp-kp-t">Who paid first, against a keeper bot</div>
              {keeper.map((k) => (
                <KeeperBar key={k.file + k.pollMs} k={k} />
              ))}
            </>
          ) : undefined
        }
        big="Not faster than every bot"
        label="What this does not claim"
        note={`A bot acting in the same block still wins${native0 ? ` (the queue captured ${Math.round(native0.meanCapture * 100)}% against one)` : ""}, and a fast polling keeper is roughly level with Reactive. Sluice removes the bot and the operator, not the race.`}
      />
    ),
  });

  const deeper = [
    race.length > 0 && {
      href: `${BASE}/dashboard/#replay`,
      title: "Race the bot, round by round",
      body: "Pick any recorded round and watch the repayment, Omni's reaction, the queue payout and the competitor on one timeline.",
    },
    batch?.ok && {
      href: `${BASE}/dashboard/#batch`,
      title: `Watch ${batch.n} lenders get paid`,
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
        <Intro>
        <section className="lp-hero" aria-labelledby="lp-name">
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
        </Intro>

        <section id="about" className="lp-about">
          <ScrollWords
            className="lp-statement"
            parts={[
              { t: "The cash comes back. " },
              { t: "The queue pays itself: ", hl: true },
              { t: "first come, first served, in about " },
              { t: `${s && s.flowB.succeeded > 0 ? (s.flowB.totalWallMs.median / 1000).toFixed(1) : "1.3"} seconds,`, hl: true },
              { t: "with no manager and no keeper bot." },
            ]}
          />
          <div className="lp-aside">
            <Reveal>
              <p>
                A lender in a fully lent-out pool doesn&apos;t get paid when they ask. They get paid when someone notices the cash is back. Sluice removes the
                someone.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <p>
                A Reactive contract watches a Morpho market we don&apos;t control, and spare credit on another chain, and pays the queue the moment liquidity returns.
                Missed events heal through retries, and bad debt halts cross-chain fronting.
              </p>
            </Reveal>
          </div>
        </section>

        <section id="context" className="sl-section sl-wrap">
          <Reveal>
            <h2>When everyone wants out, the queue is the product.</h2>
            <p className="sl-p">Withdrawals freeze when a pool is fully lent out. Here is what the public record says about it, and why seconds matter.</p>
          </Reveal>
          <Reveal delay={80}>
            <div className="lp-ctx">
              {CONTEXT.map((x) => (
                <a key={x.href} className="lp-ctx-card" href={x.href} target="_blank" rel="noreferrer">
                  <span className="lp-ctx-stat">{x.stat}</span>
                  <span className="lp-ctx-hook">{x.hook}</span>
                  <span className="lp-ctx-body">{x.body}</span>
                  <span className="lp-ctx-src">
                    {x.source} <span aria-hidden="true">↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </span>
                </a>
              ))}
            </div>
            <p className="sl-note lp-ctx-note">Figures and quotes are as those pages state them. Everything measured below comes from our own live testnet runs.</p>
          </Reveal>
        </section>

        <section id="how" className="sl-section sl-wrap">
          <div className="wf-head">
            <Reveal>
              <h2>Liquidity returns. The queue moves. Nobody has to.</h2>
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
                <h2>One repayment. Forty lenders. Paid in order.</h2>
                <p className="sl-p">
                  Forty wallets queued for cash that was fully borrowed out. Then a single repayment on Morpho paid every one of them, first come first served, and
                  nobody called anything. This is that run on Base Sepolia, replayed at real speed: each ticket turns brass the moment its callback landed.
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
              <h2>Real runs. Real hashes. Honest limits.</h2>
              <p className="sl-p">
                Every figure is a live testnet loop, traced end to end by its origin transaction hash. Open the tiles that link out to see the records. And read the last
                tile: it says what we did not prove.
              </p>
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
                  A competitor bot reaches for it a few seconds after each repayment. At Omni speed the queue gets there first. The same
                  system slowed to legacy-like speed does not.
                </p>
                <ul className="lp-points">
                  {native0 && (
                    <li>
                      <b>{Math.round(native0.meanCapture * 100)}%</b> captured against a same-block competitor. Nothing reactive beats a bot that acts in the same block, and we don&apos;t claim to.
                    </li>
                  )}
                  <li>The legacy network no longer exists (Lasna and Reactive Mainnet moved to Omni in October 2026), so the legacy-like rows reproduce its roughly 7 s blocks on Omni, using <a className="sl-link" href={REACTIVE_POST} target="_blank" rel="noreferrer">Reactive&apos;s own figure</a>.</li>
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
              <h2>Don&apos;t trust the chart. Replay the race.</h2>
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
                  A brand-new wallet that had never touched these contracts repaid 10 mUSD in the Morpho market. Reactive&apos;s signer, not us, paid the queue. Open the
                  transactions, or better, try it with your own wallet: repay part of the loan and watch the queue settle itself in about two seconds.
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
