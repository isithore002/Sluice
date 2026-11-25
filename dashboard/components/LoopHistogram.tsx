"use client";

import { useEffect, useRef, useState } from "react";

const BIN_MS = 200;

/**
 * Every one of the recorded Morpho-repayment-to-queue-paid loops, as a histogram: each bar is how many loops finished within a
 * 0.2 s slice, with the median and 95th percentile marked. It is the data behind the headline number, so the number can be
 * checked by eye. Hover (or focus and use the arrow keys) to read any slice.
 */
export function LoopHistogram({ samplesMs, medianMs, p95Ms }: { samplesMs: number[]; medianMs: number; p95Ms: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(460);
  const [hover, setHover] = useState<number | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(Math.max(220, Math.round(e.contentRect.width))));
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
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

  if (!samplesMs.length) return null;
  const maxMs = Math.ceil((Math.max(...samplesMs) + 1) / BIN_MS) * BIN_MS;
  const bins = Array.from({ length: maxMs / BIN_MS }, () => 0);
  for (const s of samplesMs) bins[Math.min(bins.length - 1, Math.floor(s / BIN_MS))]++;
  const top = Math.max(...bins);

  const H = 118, PL = 4, PR = 4, PT = 22, PB = 22;
  const iw = w - PL - PR;
  const bw = iw / bins.length;
  const x = (ms: number) => PL + (ms / maxMs) * iw;
  const bh = (n: number) => (n / top) * (H - PT - PB);
  const ticks = Array.from({ length: Math.floor(maxMs / 1000) + 1 }, (_, i) => i * 1000);
  const readout = hover === null ? null : { lo: hover * BIN_MS, hi: (hover + 1) * BIN_MS, n: bins[hover] };
  const key = (e: React.KeyboardEvent) => {
    const cur = hover ?? Math.floor(medianMs / BIN_MS);
    if (e.key === "ArrowRight") setHover(Math.min(bins.length - 1, cur + 1));
    else if (e.key === "ArrowLeft") setHover(Math.max(0, cur - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <div className="lh" ref={ref}>
      <div className="lh-top">
        <span className="lh-t">All {samplesMs.length} loops</span>
        <span className="lh-r" aria-live="polite">
          {readout ? `${readout.n} ${readout.n === 1 ? "loop" : "loops"} between ${(readout.lo / 1000).toFixed(1)} and ${(readout.hi / 1000).toFixed(1)} s` : "Hover a bar"}
        </span>
      </div>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        tabIndex={0}
        role="img"
        aria-label={`Histogram of ${samplesMs.length} loops: median ${(medianMs / 1000).toFixed(2)} seconds, 95th percentile ${(p95Ms / 1000).toFixed(2)} seconds, slowest ${(Math.max(...samplesMs) / 1000).toFixed(2)} seconds. Use the left and right arrow keys to read each bar.`}
        onKeyDown={key}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PL} x2={w - PR} y1={H - PB} y2={H - PB} stroke="var(--baseline)" />
        {bins.map((n, i) => {
          const h = shown ? bh(n) : 0;
          const lo = i * BIN_MS;
          const fast = lo + BIN_MS <= medianMs;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={PL + i * bw} y={0} width={bw} height={H - PB} fill="transparent" />
              {n > 0 && (
                <rect
                  className="lh-bar"
                  x={PL + i * bw + 1}
                  y={H - PB - h}
                  width={Math.max(1, bw - 2)}
                  height={h}
                  rx={2}
                  fill={hover === i ? "var(--brass)" : lo >= p95Ms ? "rgba(231,189,114,0.45)" : fast ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)"}
                  style={{ transitionDelay: `${i * 22}ms` }}
                />
              )}
            </g>
          );
        })}
        {/* the median and the 95th percentile */}
        <line x1={x(medianMs)} x2={x(medianMs)} y1={PT - 8} y2={H - PB} stroke="var(--brass)" strokeWidth={1.6} strokeDasharray="3 3" />
        <text x={x(medianMs) + (x(medianMs) > w * 0.7 ? -5 : 5)} y={PT - 11} textAnchor={x(medianMs) > w * 0.7 ? "end" : "start"} fontSize="11.5" fill="var(--brass)">
          median {(medianMs / 1000).toFixed(2)} s
        </text>
        <line x1={x(p95Ms)} x2={x(p95Ms)} y1={PT + 6} y2={H - PB} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="2 3" />
        <text x={x(p95Ms) + 5} y={PT + 6} fontSize="11" fill="var(--ink-2)">
          95th {(p95Ms / 1000).toFixed(2)} s
        </text>
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor={t === 0 ? "start" : "middle"} fontSize="11" fill="var(--muted)">
            {t / 1000} s
          </text>
        ))}
      </svg>
    </div>
  );
}
