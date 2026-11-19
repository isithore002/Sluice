"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceCell, ReplayRound } from "../../lib/manifest";
import { secs, usdStr } from "./format";

/**
 * Replay any recorded round of the latency race. The same round of the same competitor delay is shown twice, side by
 * side on one shared time axis: Omni at native speed, and the same system slowed by 6 Lasna blocks (~legacy).
 * Each panel is one timeline (repayment, Omni's reaction, queue payout, competitor withdrawal) with an explorer link
 * for every transaction. All numbers are the recorded measurements; nothing here is simulated.
 */
export function RaceReplay({ rounds, cells }: { rounds: ReplayRound[]; cells: RaceCell[] }) {
  const delays = useMemo(() => [...new Set(rounds.map((r) => r.competitorDelayS))].sort((a, b) => a - b), [rounds]);
  const maxIndex = useMemo(() => Math.max(1, ...rounds.map((r) => r.index)), [rounds]);

  const [delayS, setDelayS] = useState(delays.includes(2) ? 2 : delays[0] ?? 0);
  const [index, setIndex] = useState(1);
  const [t, setT] = useState<number | null>(null); // playhead in ms; null = everything shown
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef(0);

  const pick = (native: boolean) => rounds.find((r) => (r.delayBlocks === 0) === native && r.competitorDelayS === delayS && r.index === index);
  const native = pick(true);
  const legacy = pick(false);
  const legacyBlocks = rounds.find((r) => r.delayBlocks > 0)?.delayBlocks ?? 6;

  const ms = (r?: ReplayRound) => (r ? [r.sluiceActedAfterMs, r.competitorSentAfterMs, r.competitorLandedAfterMs] : []);
  const axisMs = Math.ceil(Math.max(3000, ...ms(native), ...ms(legacy)) / 1000) * 1000;

  // Any change of selection ends playback and shows the finished timeline.
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setT(null);
  }, [delayS, index]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    cancelAnimationFrame(raf.current);
    setPlaying(true);
    setT(0);
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) * speed;
      if (elapsed >= axisMs) {
        setT(null);
        setPlaying(false);
        return;
      }
      setT(elapsed);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const cell = (native: boolean) => cells.find((c) => (c.delayBlocks === 0) === native && c.competitorDelayS === delayS);
  const nativeCell = cell(true);
  const legacyCell = cell(false);

  return (
    <div className="rr">
      <div className="rr-controls">
        <div className="sl-field">
          <span id="rr-delay">Competitor waits this long after the repayment</span>
          <div className="sl-seg" role="group" aria-labelledby="rr-delay">
            {delays.map((d) => (
              <button key={d} aria-pressed={d === delayS} onClick={() => setDelayS(d)}>
                {d} s
              </button>
            ))}
          </div>
        </div>
        <div className="sl-field">
          <span id="rr-round">Recorded round</span>
          <div className="sl-seg" role="group" aria-labelledby="rr-round">
            {Array.from({ length: maxIndex }, (_, i) => i + 1).map((i) => (
              <button key={i} aria-pressed={i === index} onClick={() => setIndex(i)}>
                {i}
              </button>
            ))}
          </div>
        </div>
        <div className="sl-field">
          <span id="rr-play">Playback</span>
          <div className="rr-play" role="group" aria-labelledby="rr-play">
            <button className="sl-btn small primary" onClick={play} disabled={!native && !legacy}>
              {playing ? "Restart" : t === null ? "Replay" : "Replay"} <span aria-hidden="true">▶</span>
            </button>
            <div className="sl-seg">
              <button aria-pressed={speed === 1} onClick={() => setSpeed(1)}>
                1×
              </button>
              <button aria-pressed={speed === 0.5} onClick={() => setSpeed(0.5)}>
                0.5×
              </button>
            </div>
          </div>
        </div>
      </div>

      {nativeCell && legacyCell && (
        <p className="sl-note rr-cell" aria-live="polite">
          Over all {nativeCell.rounds} recorded rounds at {delayS} s: Omni native captured <b>{Math.round(nativeCell.meanCapture * 100)}%</b> of the
          freed liquidity, +{legacyBlocks} blocks captured <b>{Math.round(legacyCell.meanCapture * 100)}%</b>. The round below is one of them.
        </p>
      )}

      <div className="rr-panels">
        {native ? <Panel r={native} title="Omni, native speed" tone="native" axisMs={axisMs} t={t} /> : <Missing />}
        {legacy ? <Panel r={legacy} title={`Same system, +${legacy.delayBlocks} Lasna blocks (~legacy)`} tone="legacy" axisMs={axisMs} t={t} /> : <Missing />}
      </div>

      <p className="sl-note">
        Times are measured from the repayment by the harness (polling every ~150 ms). The +{legacyBlocks}-block panel is the same contract with an added delay on Omni, not
        a run on the legacy network.
      </p>
    </div>
  );
}

function Missing() {
  return <div className="sl-card rr-panel">No recorded round for this selection.</div>;
}

function Panel({ r, title, tone, axisMs, t }: { r: ReplayRound; title: string; tone: "native" | "legacy"; axisMs: number; t: number | null }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / axisMs) * 100))}%`;
  const shown = (v: number) => t === null || t >= v;
  const acted = r.sluiceActedAfterMs;
  const sent = r.competitorSentAfterMs;
  const landed = r.competitorLandedAfterMs;
  const queueWon = BigInt(r.sluiceGot) > 0n;
  const ticks = Array.from({ length: axisMs / 1000 + 1 }, (_, i) => i);

  const summary = `${title}. Competitor waits ${r.competitorDelayS} seconds. Omni pays the queue ${secs(acted)} after the repayment. The competitor's withdrawal lands at ${secs(landed)} and ${
    r.competitorOk ? "succeeds" : "reverts"
  }. ${queueWon ? "The queue" : "The competitor"} captures ${usdStr(queueWon ? r.sluiceGot : r.competitorGot)} mUSD.`;

  return (
    <div className={`sl-card rr-panel ${tone}`} role="group" aria-label={summary}>
      <div className="rr-head">
        <h4>{title}</h4>
        <span className={`sl-status ${queueWon ? "good" : "warn"}`}>
          <span className="dot" aria-hidden="true" />
          {queueWon ? "✓ Queue captured" : "! Competitor captured"} {usdStr(queueWon ? r.sluiceGot : r.competitorGot)} mUSD
        </span>
      </div>

      <div className="rr-lanes" aria-hidden="true">
        <div className="rr-lane axis">
          <span className="rr-name" />
          <div className="rr-rail">
            {ticks.map((s) => (
              <span key={s} className="rr-tick" style={{ left: pct(s * 1000) }}>
                {s}s
              </span>
            ))}
          </div>
        </div>

        <div className="rr-lane">
          <span className="rr-name">
            Repayment <small>Morpho · Base</small>
          </span>
          <div className="rr-rail">
            <i className="rr-dot base" style={{ left: "0%" }} />
            <b className="rr-label first" style={{ left: "0%" }}>
              t = 0
            </b>
          </div>
        </div>

        <div className="rr-lane">
          <span className="rr-name">
            Omni reaction <small>SluiceReactive · Lasna</small>
          </span>
          <div className="rr-rail">
            <i className={`rr-bar ${tone}`} style={{ left: "0%", width: t === null ? pct(acted) : pct(Math.min(t, acted)) }} />
            {tone === "legacy" && (
              <b className="rr-label" style={{ left: pct(acted / 2) }}>
                includes +{r.delayBlocks} blocks of added delay
              </b>
            )}
          </div>
        </div>

        <div className="rr-lane">
          <span className="rr-name">
            Queue payout <small>vault · Base</small>
          </span>
          <div className="rr-rail">
            <i className={`rr-dot ${queueWon ? "good" : "dim"} ${shown(acted) ? "on" : ""}`} style={{ left: pct(acted) }} />
            <b className={`rr-label rr-late ${shown(acted) ? "on" : ""}`} style={{ left: pct(acted) }}>
              {secs(acted)}
            </b>
          </div>
        </div>

        <div className="rr-lane">
          <span className="rr-name">
            Competitor withdrawal <small>Morpho · Base</small>
          </span>
          <div className="rr-rail">
            <i className={`rr-line ${shown(landed) ? "on" : ""}`} style={{ left: pct(sent), width: pct(landed - sent) }} />
            <i className={`rr-dot hollow ${shown(sent) ? "on" : ""}`} style={{ left: pct(sent) }} />
            <i className={`rr-dot ${r.competitorOk ? "warn" : "dim"} ${shown(landed) ? "on" : ""}`} style={{ left: pct(landed) }} />
            <b className={`rr-label rr-late ${shown(landed) ? "on" : ""}`} style={{ left: pct(landed) }}>
              {r.competitorOk ? "withdrew " : "reverted "}
              {secs(landed)}
            </b>
          </div>
        </div>

        {t !== null && (
          <div className="rr-overlay">
            <div className="rr-playhead" style={{ left: pct(t) }} />
          </div>
        )}
      </div>

      <ul className="rr-links">
        <li>
          <a className="sl-link" href={r.links.repay} target="_blank" rel="noreferrer">
            Repayment ↗
          </a>
          <span>Base block {r.chain?.repayBlock}</span>
        </li>
        {r.links.reactive && (
          <li>
            <a className="sl-link" href={r.links.reactive} target="_blank" rel="noreferrer">
              {r.delayBlocks > 0 ? "Omni schedules the pull ↗" : "Omni reacts ↗"}
            </a>
            <span>Lasna block {r.chain?.reactiveBlock}</span>
          </li>
        )}
        {r.delayBlocks > 0 && r.links.reactiveRequested && r.links.reactiveRequested !== r.links.reactive && (
          <li>
            <a className="sl-link" href={r.links.reactiveRequested} target="_blank" rel="noreferrer">
              Omni requests the pull ↗
            </a>
            <span>
              Lasna block {r.chain?.requestedBlock}
              {r.chain?.reactiveBlock && r.chain?.requestedBlock ? `, ${Number(r.chain.requestedBlock) - Number(r.chain.reactiveBlock)} blocks later` : ""}
            </span>
          </li>
        )}
        <li>
          <a className="sl-link" href={r.links.sluice} target="_blank" rel="noreferrer">
            Queue payout ↗
          </a>
          <span>Base block {r.chain?.sluiceBlock}</span>
        </li>
        <li>
          <a className="sl-link" href={r.links.competitor} target="_blank" rel="noreferrer">
            Competitor withdrawal ↗
          </a>
          <span>
            Base block {r.chain?.competitorBlock} · {r.competitorOk ? "succeeded" : "reverted"}
          </span>
        </li>
      </ul>
    </div>
  );
}
