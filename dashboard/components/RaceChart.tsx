"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { RaceCell } from "../lib/manifest";
import "./race-chart.css";

type Key = "native" | "legacy";

const SERIES: { key: Key; label: string; short: string; color: string; pick: (c: RaceCell) => boolean }[] = [
  { key: "native", label: "Omni, native speed", short: "Omni native", color: "var(--series-1)", pick: (c) => c.delayBlocks === 0 },
  { key: "legacy", label: "Same system, +legacy-like delay", short: "+legacy delay", color: "var(--series-2)", pick: (c) => c.delayBlocks > 0 },
];

/** The competitor's own transaction takes about this long to land after it fires, measured on a public RPC (see the README). */
const LAND_MS = 1300;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (ms: number, d = 2) => `${(ms / 1000).toFixed(d)} s`;

type Verdict = { tone: "win" | "lose" | "split"; text: string };
const verdict = (c: RaceCell): Verdict =>
  c.meanCapture >= 0.995
    ? { tone: "win", text: "The queue captured all of it" }
    : c.meanCapture <= 0.005
      ? { tone: "lose", text: "The competitor took all of it" }
      : { tone: "split", text: `Split: the queue got ${pct(c.meanCapture)}` };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * The latency race, explained. Top: the share of freed liquidity the queue captured, against how long the competitor waited, for
 * Omni at native speed and for the same contracts slowed to legacy-like speed. The dashed lines mark the delay from which the queue
 * can start to win (the median time it acts, less the time the competitor's own transaction takes to land), which is why each
 * line steps up where it does. Hover, tap or use the arrow keys to pick a delay; below the chart, a readout shows the numbers for it and a
 * timeline of who got there first. Click a legend entry to hide or show a series.
 */
export function RaceChart({ cells, table = true }: { cells: RaceCell[]; table?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Record<Key, boolean>>({ native: false, legacy: false });
  const [drawn, setDrawn] = useState(false);
  const [asTable, setAsTable] = useState(false);

  // Size the SVG to its container so text stays 12px at every width (a fixed viewBox would shrink it on phones).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (entry.contentRect.width > 0) setWidth(Math.max(300, Math.round(entry.contentRect.width))); // a hidden chart reports 0: keep the last real width
      });
    });
    ro.observe(el);
    // draw the lines in the first time the chart scrolls into view
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) setDrawn(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const series = useMemo(
    () => SERIES.map((s) => ({ ...s, points: cells.filter(s.pick).sort((a, b) => a.competitorDelayS - b.competitorDelayS) })),
    [cells],
  );
  const delays = useMemo(() => [...new Set(cells.map((c) => c.competitorDelayS))].sort((a, b) => a - b), [cells]);
  if (!delays.length) return null;

  const at = (key: Key, d: number) => series.find((s) => s.key === key)?.points.find((c) => c.competitorDelayS === d);
  // the delay that tells the story best, as a starting point: the first one where Omni wins everything and the slowed system nothing
  const fallback = delays.find((d) => (at("native", d)?.meanCapture ?? 0) >= 0.995 && (at("legacy", d)?.meanCapture ?? 1) <= 0.005) ?? delays[Math.min(1, delays.length - 1)];
  const active = hover ?? pinned ?? fallback;

  // when the queue acts, per series: the median over every round it was measured in
  const acts = Object.fromEntries(series.map((s) => [s.key, median(s.points.map((c) => c.sluiceActedMs.median))])) as Record<Key, number>;

  const W = width;
  const narrow = width < 520;
  const H = narrow ? 250 : 320;
  const L = 44, R = narrow ? 84 : 118, T = 26, B = 44;
  const xMin = Math.min(...delays), xMax = Math.max(...delays);
  const x = (d: number) => (xMax === xMin ? L + (W - L - R) / 2 : L + ((d - xMin) / (xMax - xMin)) * (W - L - R));
  const y = (p: number) => T + (1 - p) * (H - T - B);

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const px = clientX - svg.getBoundingClientRect().left;
    return delays.reduce((best, d) => (Math.abs(x(d) - px) < Math.abs(x(best) - px) ? d : best), delays[0]);
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (e.pointerType === "touch") return; // a touch pins on tap instead, so scrolling past the chart does not change it
    setHover(nearest(e.clientX, e.currentTarget.ownerSVGElement!));
  };
  const onDown = (e: PointerEvent<SVGRectElement>) => {
    const d = nearest(e.clientX, e.currentTarget.ownerSVGElement!);
    setPinned((p) => (p === d && e.pointerType !== "touch" ? null : d));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = delays.indexOf(active);
    const go = (j: number) => {
      e.preventDefault();
      setHover(null);
      setPinned(delays[Math.max(0, Math.min(delays.length - 1, j))]);
    };
    if (e.key === "ArrowRight" || e.key === "ArrowUp") go(i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(delays.length - 1);
    else if (e.key === "Escape") setPinned(null);
  };
  const toggle = (k: Key) =>
    setHidden((h) => {
      const other: Key = k === "native" ? "legacy" : "native";
      return !h[k] && h[other] ? h : { ...h, [k]: !h[k] }; // one line always stays visible
    });

  // end-of-line labels: when both series end at (nearly) the same height, push them apart so they never overprint
  const endY = (key: Key) => {
    const pts = series.find((s) => s.key === key)?.points ?? [];
    return pts.length ? y(pts[pts.length - 1].meanCapture) + 4 : 0;
  };
  const labelY = (key: Key) => {
    const a = endY("native");
    const b = endY("legacy");
    if (Math.abs(a - b) >= 16 || a === 0 || b === 0 || hidden.native || hidden.legacy) return key === "native" ? a : b;
    const mid = (a + b) / 2;
    return key === "native" ? mid - 9 : mid + 9;
  };

  const first = at("native", delays[0]);
  const summary = `At a competitor delay of ${active} s: ${series
    .map((s) => {
      const c = at(s.key, active);
      return c ? `${s.label}, ${pct(c.meanCapture)} captured by the queue` : "";
    })
    .filter(Boolean)
    .join("; ")}.`;

  return (
    <div className="rc">
      <div className="rc-bar">
        {asTable ? (
          <span className="rc-t">Every recorded cell of the race</span>
        ) : (
          <div className="legend" role="group" aria-label="Show or hide a line">
            {series.map((s) => (
              <button key={s.key} type="button" className="rc-leg" aria-pressed={!hidden[s.key]} onClick={() => toggle(s.key)} title={hidden[s.key] ? "Show this line" : "Hide this line"}>
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
        {table && (
          <button type="button" className="rc-link" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show the chart" : "Show as a table"}
          </button>
        )}
      </div>

      {asTable && (
        <div className="sl-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Sluice speed</th>
                <th className="num">Competitor fires after</th>
                <th className="num">Rounds</th>
                <th className="num">Queue captured</th>
                <th className="num">Queue acted (median)</th>
                <th className="num">Range</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((s) =>
                s.points.map((c) => (
                  <tr key={s.key + c.competitorDelayS}>
                    <td>{s.short}</td>
                    <td className="num">{c.competitorDelayS} s</td>
                    <td className="num">{c.rounds}</td>
                    <td className="num">{pct(c.meanCapture)}</td>
                    <td className="num">{sec(c.sluiceActedMs.median)}</td>
                    <td className="num">
                      {sec(c.sluiceActedMs.min, 1)} to {sec(c.sluiceActedMs.max, 1)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* the chart stays mounted while the table shows (just hidden), so its size observers keep working and it is the right size when it comes back */}
      {(
        <div hidden={asTable} className="rc-views">
          <div className="chart-wrap rc-chart" ref={wrapRef} tabIndex={0} role="group" aria-roledescription="interactive chart" aria-label="Share of freed liquidity captured by the queue, by how long the competitor waits. Use the left and right arrow keys to choose a delay." onKeyDown={onKey}>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t}>
                  <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
                  <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
                    {Math.round(t * 100)}%
                  </text>
                </g>
              ))}

              {/* where the queue wins, in each line's colour: once the competitor's transaction would land after the queue has acted,
                  that is, for a competitor delay above (when the queue acts) minus (how long the competitor's transaction takes to land) */}
              {series.map((s) => {
                const wx = Math.max(xMin, acts[s.key] / 1000 - LAND_MS / 1000);
                if (hidden[s.key] || wx > xMax) return null;
                return (
                  <g key={"zone" + s.key}>
                    <rect x={x(wx)} y={T} width={Math.max(0, W - R - x(wx))} height={H - T - B} fill={s.color} opacity={0.07} />
                    <line x1={x(wx)} x2={x(wx)} y1={T - 4} y2={H - B} stroke={s.color} strokeWidth={1.4} strokeDasharray="4 4" opacity={0.85} />
                    <text x={x(wx) + (s.key === "legacy" ? -6 : 6)} y={T - 9} textAnchor={s.key === "legacy" ? "end" : "start"} fontSize="11.5" fill={s.color}>
                      queue wins from about {wx.toFixed(1)} s
                    </text>
                  </g>
                );
              })}

              {delays.map((d) => (
                <g key={d}>
                  {d === active && <rect x={x(d) - 17} y={H - B + 6} width={34} height={20} rx={10} fill="var(--ink)" opacity={0.95} />}
                  <text x={x(d)} y={H - B + 20} textAnchor="middle" fontSize="12" fontWeight={d === active ? 650 : 400} fill={d === active ? "#09090a" : "var(--muted)"}>
                    {d} s
                  </text>
                </g>
              ))}
              <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--ink-2)">
                Competitor waits this long after the repayment
              </text>

              {/* the crosshair for the chosen delay */}
              <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="2 3" />

              {series.map((s) => {
                if (hidden[s.key]) return null;
                const pts = s.points;
                return (
                  <g key={s.key}>
                    <polyline
                      className="rc-line"
                      data-drawn={drawn}
                      pathLength={1}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2.2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={pts.map((c) => `${x(c.competitorDelayS)},${y(c.meanCapture)}`).join(" ")}
                    />
                    {pts.map((c, i) => {
                      const on = c.competitorDelayS === active;
                      return (
                        <g key={c.competitorDelayS} className="rc-pt" data-drawn={drawn} style={{ transitionDelay: `${0.5 + i * 0.12}s` }}>
                          {on && <circle cx={x(c.competitorDelayS)} cy={y(c.meanCapture)} r={11} fill={s.color} opacity={0.18} />}
                          <circle cx={x(c.competitorDelayS)} cy={y(c.meanCapture)} r={on ? 6.5 : 5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                          {on && (
                            <text x={x(c.competitorDelayS)} y={y(c.meanCapture) + (c.meanCapture > 0.85 ? 22 : -14)} textAnchor="middle" fontSize="12.5" fontWeight={650} fill={s.color}>
                              {pct(c.meanCapture)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {pts.length > 0 && (
                      <text x={x(pts[pts.length - 1].competitorDelayS) + 12} y={labelY(s.key)} fontSize="12" fill="var(--ink-2)">
                        {s.short}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* the one point worth a note: a bot that fires at once still wins */}
              {!hidden.native && first && first.meanCapture < 0.5 && delays[0] === 0 && (
                <text x={x(0) + 12} y={y(first.meanCapture) + 4} fontSize="11.5" fill="var(--ink-2)">
                  a bot firing at once still wins most rounds
                </text>
              )}

              {/* the hit area: moving over it picks a delay, tapping or clicking pins it */}
              <rect x={L - 14} y={T - 14} width={W - R - L + 28} height={H - T - B + 40} fill="transparent" style={{ cursor: "crosshair", touchAction: "pan-y" }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onDown} />
            </svg>
          </div>

          <p className="rc-hint">{pinned !== null && hover === null ? `Pinned at ${pinned} s. Click it again, or press Esc, to release.` : "Hover, tap or use the arrow keys to compare a delay. Click to pin it."}</p>

          <Readout series={series} active={active} acts={acts} hidden={hidden} />
          <p className="sr-only" aria-live="polite">
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}

/** For the chosen delay: the numbers for each line, and a timeline of who got there first. */
function Readout({ series, active, acts, hidden }: { series: { key: Key; label: string; short: string; color: string; points: RaceCell[] }[]; active: number; acts: Record<Key, number>; hidden: Record<Key, boolean> }) {
  const rows = series.map((s) => ({ s, c: s.points.find((p) => p.competitorDelayS === active) })).filter((r) => r.c) as { s: (typeof series)[number]; c: RaceCell }[];
  const axisMax = Math.max(10, ...rows.map((r) => r.c.sluiceActedMs.max / 1000 + 0.6), active + LAND_MS / 1000 + 0.6);
  const [laneW, setLaneW] = useState(560);
  const laneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (e.contentRect.width > 0) setLaneW(Math.max(280, Math.round(e.contentRect.width)));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  const LL = 92, LR = 12;
  const tx = (s: number) => LL + (s / axisMax) * (laneW - LL - LR);
  const rowH = 34, LT = 30;
  const LH = LT + rows.length * rowH + 28;

  return (
    <div className="rc-read">
      <div className="rc-cols">
        {rows.map(({ s, c }) => {
          const v = verdict(c);
          return (
            <div key={s.key} className="rc-col" data-hidden={hidden[s.key]} style={{ ["--c" as string]: s.color }}>
              <div className="rc-col-h">
                <span className="swatch" style={{ background: s.color }} />
                {s.short}
              </div>
              <div className="rc-big">{pct(c.meanCapture)}</div>
              <div className={`rc-chip ${v.tone}`}>{v.text}</div>
              <dl className="rc-facts">
                <div>
                  <dt>Rounds</dt>
                  <dd>{c.rounds}</dd>
                </div>
                <div>
                  <dt>Queue acted after</dt>
                  <dd>
                    {sec(c.sluiceActedMs.median)} <span>median</span>
                  </dd>
                </div>
                <div>
                  <dt>Fastest to slowest</dt>
                  <dd>
                    {sec(c.sluiceActedMs.min, 1)} to {sec(c.sluiceActedMs.max, 1)}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <div className="rc-lane" ref={laneRef}>
        <div className="rc-lane-t">Who got there first, with the competitor firing {active} s after the repayment</div>
        <svg width={laneW} height={LH} viewBox={`0 0 ${laneW} ${LH}`} role="img" aria-label={`Timeline in seconds after the repayment. The competitor fires at ${active} seconds. ${rows.map((r) => `${r.s.short}: the queue acted between ${(r.c.sluiceActedMs.min / 1000).toFixed(1)} and ${(r.c.sluiceActedMs.max / 1000).toFixed(1)} seconds.`).join(" ")}`}>
          {Array.from({ length: Math.floor(axisMax / 2) + 1 }, (_, i) => i * 2).map((t) => (
            <g key={t}>
              <line x1={tx(t)} x2={tx(t)} y1={LT - 6} y2={LT + rows.length * rowH} stroke="var(--grid)" strokeWidth={1} />
              <text x={tx(t)} y={LH - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {t} s
              </text>
            </g>
          ))}
          {/* the competitor: when it fires, and roughly when its transaction lands */}
          <rect x={tx(active)} y={LT - 6} width={Math.max(0, tx(active + LAND_MS / 1000) - tx(active))} height={rows.length * rowH + 6} fill="var(--ink)" opacity={0.1} />
          <line x1={tx(active)} x2={tx(active)} y1={LT - 10} y2={LT + rows.length * rowH} stroke="var(--ink)" strokeWidth={1.6} />
          <text x={tx(active) + (tx(active) > laneW * 0.62 ? -6 : 6)} y={LT - 14} textAnchor={tx(active) > laneW * 0.62 ? "end" : "start"} fontSize="11.5" fill="var(--ink)">
            competitor fires
          </text>
          {rows.map(({ s, c }, i) => {
            const cy = LT + i * rowH + rowH / 2 - 3;
            const m = c.sluiceActedMs;
            return (
              <g key={s.key} opacity={hidden[s.key] ? 0.3 : 1}>
                <text x={LL - 10} y={cy + 4} textAnchor="end" fontSize="12" fill="var(--ink-2)">
                  {s.short}
                </text>
                <rect x={tx(m.min / 1000)} y={cy - 6} width={Math.max(3, tx(m.max / 1000) - tx(m.min / 1000))} height={12} rx={6} fill={s.color} opacity={0.38} />
                <rect x={tx(m.median / 1000) - 2} y={cy - 9} width={4} height={18} rx={2} fill={s.color} />
              </g>
            );
          })}
        </svg>
        <p className="rc-note">
          Each bar is how long the queue took to act, fastest to slowest round, with the bold tick at the median. The shaded strip is about when the competitor&apos;s own
          transaction lands (roughly 1.2 to 1.4 s after it fires, on a public RPC). The queue wins a round when it acts before that strip ends.
        </p>
      </div>
    </div>
  );
}
