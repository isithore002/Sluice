"use client";

import { useEffect, useRef, useState } from "react";
import type { RaceCell } from "../lib/manifest";

/**
 * Queue capture rate vs competitor delay, one line per Sluice speed.
 * Thin 2px lines, 8px markers with a surface ring, recessive grid, legend + direct end labels, per-point hover.
 */
export function RaceChart({ cells }: { cells: RaceCell[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; c: RaceCell } | null>(null);
  // Size the SVG to its container so text stays 12px at every width (a fixed viewBox would shrink it on phones).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = [
    { key: "native", label: "Omni, native speed", color: "var(--series-1)", pick: (c: RaceCell) => c.delayBlocks === 0 },
    { key: "legacy", label: "Same system, +legacy-like delay", color: "var(--series-2)", pick: (c: RaceCell) => c.delayBlocks > 0 },
  ].map((s) => ({ ...s, points: cells.filter(s.pick).sort((a, b) => a.competitorDelayS - b.competitorDelayS) }));

  const delays = [...new Set(cells.map((c) => c.competitorDelayS))].sort((a, b) => a - b);
  const W = width;
  const H = width < 520 ? 240 : 320;
  const L = 44, R = width < 520 ? 92 : 120, T = 16, B = 44;
  const xMin = Math.min(...delays), xMax = Math.max(...delays);
  const x = (d: number) => (xMax === xMin ? L + (W - L - R) / 2 : L + ((d - xMin) / (xMax - xMin)) * (W - L - R));
  const y = (p: number) => T + (1 - p) * (H - T - B);

  // End-of-line labels: when both series end at (nearly) the same height, push them apart so they never overprint.
  const endY = (key: string) => {
    const pts = series.find((s) => s.key === key)?.points ?? [];
    return pts.length ? y(pts[pts.length - 1].meanCapture) + 4 : 0;
  };
  const labelY = (key: string) => {
    const a = endY("native"), b = endY("legacy");
    if (Math.abs(a - b) >= 16 || a === 0 || b === 0) return key === "native" ? a : b;
    const mid = (a + b) / 2;
    return key === "native" ? mid - 9 : mid + 9;
  };

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Share of freed liquidity captured by the queue, by competitor delay"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {delays.map((d) => (
          <text key={d} x={x(d)} y={H - B + 20} textAnchor="middle" fontSize="12" fill="var(--muted)">
            {d} s
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--ink-2)">
          Competitor waits this long after the repayment
        </text>

        {series.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points.map((c) => `${x(c.competitorDelayS)},${y(c.meanCapture)}`).join(" ")}
            />
            {s.points.map((c) => (
              <g key={c.competitorDelayS}>
                <circle cx={x(c.competitorDelayS)} cy={y(c.meanCapture)} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                <circle
                  cx={x(c.competitorDelayS)}
                  cy={y(c.meanCapture)}
                  r={16}
                  fill="transparent"
                  onMouseEnter={() => setHover({ x: x(c.competitorDelayS), y: y(c.meanCapture), c })}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            ))}
            {s.points.length > 0 && (
              <text
                x={x(s.points[s.points.length - 1].competitorDelayS) + 12}
                y={labelY(s.key)}
                fontSize="12"
                fill="var(--ink-2)"
              >
                {s.key === "native" ? "Omni native" : "+legacy delay"}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y + 30 }}>
          <div className="t">
            {hover.c.delayBlocks === 0 ? "Omni native" : `+${hover.c.delayBlocks} Lasna blocks`} · competitor at {hover.c.competitorDelayS} s
          </div>
          <div>
            <strong>{Math.round(hover.c.meanCapture * 100)}%</strong> captured by the queue
          </div>
          <div className="t">
            {hover.c.rounds} rounds · Sluice acted at {(hover.c.sluiceActedMs.median / 1000).toFixed(2)} s (median)
          </div>
        </div>
      )}
    </div>
  );
}
