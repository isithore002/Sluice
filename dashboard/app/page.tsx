"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo3D } from "../components/Logo3D";
import { CountUp, Reveal } from "../components/Motion";
import { RaceChart } from "../components/RaceChart";
import { SiteShell } from "../components/SiteShell";
import { loadManifest, type Manifest } from "../lib/manifest";
import "./landing.css";

const GITHUB = "https://github.com/isithore002/Sluice";

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
    tag: "event",
    title: "Something frees liquidity",
    body: "A borrower repays in a Morpho market we don't control, a deposit lands, or another chain has spare credit.",
  },
  {
    tag: "reaction",
    title: "Reactive decides, in about a second",
    body: "SluiceReactive sees the event on Lasna and tells the vault to pull from Morpho, or the reserve to front the shortfall.",
  },
  {
    tag: "callback",
    title: "The queue is paid in order",
    body: "First come, first served, with partial fills at the head. Missed events heal through retries; bad debt halts cross-chain fronting.",
  },
];

export default function Landing() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch(() => {});
  }, []);

  const s = manifest?.summary ?? null;
  const batch = manifest?.batch ?? null;
  const caseStudy = manifest?.caseStudy ?? null;
  const race = s?.race ?? [];
  const capture = (native: boolean, delay: number) => race.find((c) => (c.delayBlocks === 0) === native && c.competitorDelayS === delay);
  const native4 = capture(true, 4);
  const legacy4 = capture(false, 4);
  const native0 = capture(true, 0);

  const stats: { value: ReactNode; label: string }[] = [];
  if (s && s.flowB.succeeded > 0)
    stats.push({ value: <CountUp to={s.flowB.totalWallMs.median / 1000} decimals={2} suffix=" s" />, label: "median, Morpho repayment to queue paid" });
  if (s && s.flowB.attempted > 0)
    stats.push({
      value: (
        <>
          <CountUp to={s.flowB.succeeded} />/{s.flowB.attempted}
        </>
      ),
      label: "live loops settled end to end",
    });
  if (s?.independent && s.independent.succeeded > 0)
    stats.push({
      value: (
        <>
          <CountUp to={s.independent.succeeded} />/{s.independent.attempted}
        </>
      ),
      label: "settled for a user by a different wallet",
    });
  if (batch?.ok)
    stats.push({
      value: <CountUp to={batch.n} />,
      label: `withdrawals paid from ONE repayment, in ${(batch.timing.repayToQueueEmptyMs / 1000).toFixed(1)} s, first come first served`,
    });
  if (native4 && legacy4)
    stats.push({
      value: (
        <>
          <CountUp to={native4.meanCapture * 100} suffix="%" /> <span className="lp-vs">vs</span> {Math.round(legacy4.meanCapture * 100)}%
        </>
      ),
      label: `queue captured against a 4 s competitor: Omni vs +${legacy4.delayBlocks} blocks (~legacy)`,
    });

  const deeper = [
    race.length > 0 && {
      href: "/dashboard#replay",
      tag: "interactive",
      title: "Replay the latency race",
      body: "Pick any recorded round and watch the repayment, Omni's reaction, the queue payout and the competitor on one timeline.",
    },
    batch?.ok && {
      href: "/dashboard#batch",
      tag: "live run",
      title: `One repayment, ${batch.n} withdrawals`,
      body: `A callback pays at most ${batch.cap}. Reactive scheduled the next batch by itself, and everyone was paid in order.`,
    },
    caseStudy && {
      href: "/dashboard#case",
      tag: "case study",
      title: "The loop that didn't count",
      body: `${caseStudy.counts.recorded} of ${caseStudy.counts.attempted} cross-chain loops were measured. Here is exactly what happened to the other one.`,
    },
  ].filter(Boolean) as { href: string; tag: string; title: string; body: string }[];

  return (
    <SiteShell
      links={[
        { href: "#how", label: "How it works" },
        { href: "#why", label: "Why Omni" },
        { href: "#proof", label: "Proof" },
        { href: GITHUB, label: "GitHub" },
      ]}
      cta={{ href: "/dashboard", label: "Live dashboard" }}
    >
      <main id="top">
        <div className="lp-hero sl-wrap">
          <div className="lp-copy" data-ascii-avoid="0.85">
            <p className="lp-eyebrow sl-rise" style={{ animationDelay: "0.05s" }}>
              <span>*</span> Every Second Counts<span className="lp-caret" aria-hidden="true" />
            </p>
            <h1 className="sl-title lp-title">
              <span className="a sl-rise" style={{ animationDelay: "0.15s" }}>
                Withdrawal queues that
              </span>
              <span className="b" style={{ animationDelay: "0.28s" }}>
                settle themselves.
              </span>
            </h1>
            <p className="lp-lede sl-rise" style={{ animationDelay: "0.42s" }}>
              When liquidity comes back anywhere (a repayment in a Morpho market we don&apos;t control, or spare credit on another chain), a
              Reactive contract pays the queue in order within a couple of seconds. No manager. No keeper bot.
            </p>
            <div className="sl-cta sl-rise" style={{ animationDelay: "0.54s" }}>
              <Link href="/dashboard" className="sl-btn primary">
                Open live dashboard <span aria-hidden="true">→</span>
              </Link>
              <a href={GITHUB} target="_blank" rel="noreferrer" className="sl-btn">
                Read the source
              </a>
            </div>
            <div className="sl-chips sl-rise" style={{ animationDelay: "0.66s" }}>
              <span className="sl-chip base">Base Sepolia</span>
              <span className="sl-chip lasna">Reactive Lasna</span>
              <span className="sl-chip uni">Unichain Sepolia</span>
            </div>
          </div>

          <div className="lp-stage" data-ascii-avoid="0.8" data-ascii-pad="220" data-ascii-calm>
            <Logo3D />
            <p className="lp-cap">Built on Reactive Omni · ~1 s blocks</p>
          </div>
        </div>

        {stats.length > 0 && (
          <div className="sl-wrap">
            <Reveal>
              <div className="lp-stats sl-card" data-ascii-avoid="0.9">
                {stats.map((st, i) => (
                  <div key={i} className="lp-stat">
                    <div className="lp-num">{st.value}</div>
                    <div className="lp-label">{st.label}</div>
                  </div>
                ))}
                <p className="lp-foot">Live testnet loops, traced end to end by the origin transaction hash.</p>
              </div>
            </Reveal>
          </div>
        )}

        <section id="how" className="sl-section sl-wrap">
          <div data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">How it works</p>
              <h2>Liquidity returns. The queue moves.</h2>
            </Reveal>
            <div className="lp-steps">
              {STEPS.map((st, i) => (
                <Reveal key={st.tag} delay={i * 120}>
                  <div className="sl-card lp-step">
                    <span className="lp-idx">0{i + 1}</span>
                    <span className="sl-tag lp-tag">{st.tag}</span>
                    <h3>{st.title}</h3>
                    <p>{st.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {race.length > 0 && (
          <section id="why" className="sl-section sl-wrap">
            <div className="lp-why" data-ascii-avoid="0.8">
              <Reveal>
                <p className="sl-kicker">Why Omni</p>
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
                  <li>The legacy-like rows add delay on Omni; they are not runs on the legacy network.</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <div className="sl-card lp-chart">
                  <RaceChart cells={race} />
                </div>
              </Reveal>
            </div>
          </section>
        )}

        {deeper.length > 0 && (
          <section className="sl-section tight sl-wrap" data-ascii-avoid="0.8">
            <Reveal>
              <p className="sl-kicker">Go deeper</p>
              <h2>Don&apos;t just read it. Replay it.</h2>
            </Reveal>
            <div className="lp-deeper">
              {deeper.map((d, i) => (
                <Reveal key={d.href} delay={i * 100}>
                  <Link href={d.href} className="sl-card lp-step lp-link">
                    <span className="sl-tag lp-tag">{d.tag}</span>
                    <h3>{d.title}</h3>
                    <p>{d.body}</p>
                    <span className="lp-more">
                      Open <span aria-hidden="true">→</span>
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <section id="proof" className="sl-section sl-wrap">
          <Reveal>
            <div className="sl-card lp-proof" data-ascii-avoid="0.9">
              <div>
                <p className="sl-kicker">Proof</p>
                <h2>Don&apos;t take our word for it.</h2>
                <p className="sl-p">
                  A fresh wallet we created for this test, which had never touched these contracts, repaid 10 mUSD in the Morpho market. The settlement that paid the queue
                  was sent by Reactive&apos;s signer, not by us. Open it, or run the same three commands yourself, which is the stronger check.
                </p>
                <div className="sl-cta">
                  <a href={baseTx(OUTSIDER.settlement)} target="_blank" rel="noreferrer" className="sl-btn primary">
                    View the settlement <span aria-hidden="true">↗</span>
                  </a>
                  <a href={`${GITHUB}#try-it-yourself`} target="_blank" rel="noreferrer" className="sl-btn">
                    Try it yourself
                  </a>
                  <Link href="/dashboard" className="sl-btn">
                    Live dashboard
                  </Link>
                </div>
              </div>
              <div className="lp-trace" aria-label="Trace of the outsider test">
                <div className="hd">trace outsider-test</div>
                <div className="row">
                  <span className="k">fresh wallet</span>
                  <span className="v">{short(OUTSIDER.wallet)}<span className="sub">3 transactions ever: mint, approve, repay</span></span>
                </div>
                <div className="row">
                  <span className="k">repay</span>
                  <span className="v">
                    <a href={baseTx(OUTSIDER.repay)} target="_blank" rel="noreferrer">{short(OUTSIDER.repay, 8, 4)}</a>
                    <span className="sub">10 mUSD into the Morpho market · Base Sepolia</span>
                  </span>
                </div>
                <div className="row">
                  <span className="k">settlement</span>
                  <span className="v">
                    <a href={baseTx(OUTSIDER.settlement)} target="_blank" rel="noreferrer">{short(OUTSIDER.settlement, 8, 4)}</a>
                    <span className="sub">
                      sent by <span className="ok">{short(OUTSIDER.signer, 4, 4)}</span>, Reactive&apos;s signer
                    </span>
                  </span>
                </div>
                <div className="row">
                  <span className="k">paid</span>
                  <span className="v">
                    10 mUSD → {short(OUTSIDER.paidTo, 4, 4)}<span className="sub">the user waiting in the queue · nothing left owed</span>
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
