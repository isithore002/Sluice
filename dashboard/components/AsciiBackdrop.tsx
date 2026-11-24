"use client";

import { useEffect, useRef } from "react";

/* A faint Japanese scene drawn in text behind the hero: Mount Fuji under a low sun, a pagoda on a rock, rolling waves with the
 * sun's path on them, sakura petals drifting past, and a few vertical lines of kanji. It is built from rules (shapes in a grid
 * of characters) rather than a fixed picture, so it fills any size of screen. Everything is drawn in low alpha so it reads as a
 * texture behind the words, never over them. */

const FONT = '"JetBrains Mono Variable", "Cascadia Mono", Consolas, Menlo, monospace';
const CJK = '"Yu Gothic UI", "Yu Gothic", Meiryo, "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';

/** How strong the whole scene is. 1 would be the full-strength colours; it is meant to sit well below that. */
const STRENGTH = 0.62;

type Tint = 0 | 1 | 2; // 0 pale grey, 1 warm brass, 2 sakura pink
const TINTS: [number, number, number][] = [
  [226, 226, 232],
  [231, 189, 114],
  [255, 150, 190],
];

const PAGODA = [
  "          |          ",
  "         _|_         ",
  "       _/___\\_       ",
  "         |_|         ",
  "      __/___\\__      ",
  "        |   |        ",
  "     __/_____\\__     ",
  "       |  _  |       ",
  "    __/_______\\__    ",
  "      |  | |  |      ",
  "   __/_________\\__   ",
  "     | [] [] [] |    ",
  "  __/___________\\__  ",
  " /_________________\\ ",
  "  |  |  |   |  |  |  ",
  " /####################\\",
];

// vertical lines of kanji and kana (read top to bottom): "sluice gate", "the water moves, the queue moves", "no waiting"
const COLUMNS: { x: number; y: number; text: string; tint: Tint; a: number }[] = [
  { x: 0.945, y: 0.2, text: "水門", tint: 1, a: 0.5 },
  { x: 0.905, y: 0.2, text: "流れは止まらない", tint: 0, a: 0.34 },
  { x: 0.045, y: 0.3, text: "待ち行列が動く", tint: 0, a: 0.34 },
  { x: 0.085, y: 0.3, text: "順番どおりに", tint: 0, a: 0.28 },
];

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

type Cell = { ch: string; a: number; tint: Tint };

export function AsciiBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let C = 0; // columns and rows of characters
    let R = 0;
    let cw = 0; // one character cell, in canvas px
    let ch = 0;
    let fs = 0;
    let horizon = 0;
    let sunCol = 0;
    let still: HTMLCanvasElement | null = null;
    let petals: { x: number; y: number; vx: number; vy: number; ph: number; ch: string; pink: boolean }[] = [];
    let raf = 0;
    let visible = true;
    let last = 0;
    const t0 = performance.now();

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH) return;
      W = Math.round(cssW * dpr);
      H = Math.round(cssH * dpr);
      canvas.width = W;
      canvas.height = H;
      fs = Math.max(10, Math.min(15, Math.round(cssW / 120))) * dpr;
      ctx.font = `${fs}px ${FONT}`;
      cw = ctx.measureText("M").width || fs * 0.6;
      ch = fs * 1.3;
      C = Math.floor(W / cw);
      R = Math.floor(H / ch);
      horizon = Math.round(R * 0.8);
      sunCol = Math.round(C * 0.73);

      const grid: (Cell | null)[][] = Array.from({ length: R }, () => Array(C).fill(null));
      const put = (c: number, r: number, chr: string, a: number, tint: Tint = 0) => {
        if (c < 0 || c >= C || r < 0 || r >= R || chr === " ") return;
        grid[r][c] = { ch: chr, a, tint };
      };
      const aspect = ch / cw;

      // a few thin clouds
      for (const [cx, cr, len] of [[0.16, 0.2, 26], [0.5, 0.12, 20], [0.86, 0.46, 24], [0.12, 0.5, 18]] as const) {
        const r = Math.round(R * cr);
        const c0 = Math.round(C * cx - len / 2);
        for (let i = 0; i < len; i++) put(c0 + i, r, i % 7 === 3 ? "~" : "-", 0.13);
        for (let i = 3; i < len - 4; i++) put(c0 + i, r + 1, i % 5 === 1 ? "." : "_", 0.09);
      }

      // the sun: a disc with a rim
      const sunRow = Math.round(R * 0.3);
      const sunR = Math.max(3, R * 0.1);
      for (let r = Math.floor(sunRow - sunR); r <= sunRow + sunR; r++) {
        const dy = r - sunRow;
        const half = Math.sqrt(Math.max(0, sunR * sunR - dy * dy)) * aspect;
        for (let c = Math.ceil(sunCol - half); c <= sunCol + half; c++) {
          const edge = Math.abs(c - sunCol) > half - 1.4 || Math.abs(dy) > sunR - 0.9;
          put(c, r, edge ? "O" : hash(c, r) > 0.5 ? "0" : "o", edge ? 0.34 : 0.22, 1);
        }
      }

      // Mount Fuji: a long concave slope, with snow on the top quarter
      const fujiCol = Math.round(C * 0.33);
      const peak = Math.round(R * 0.3);
      const baseHalf = C * 0.24;
      for (let r = peak; r <= horizon; r++) {
        const t = (r - peak) / Math.max(1, horizon - peak);
        const half = baseHalf * (0.05 + 0.95 * Math.pow(t, 1.35));
        const left = Math.round(fujiCol - half);
        const right = Math.round(fujiCol + half);
        for (let c = left; c <= right; c++) {
          const snow = t < 0.27 && Math.abs(c - fujiCol) < half - 1 - (0.27 - t) * 12 * hash(r, 3);
          if (c === left) put(c, r, "/", 0.3);
          else if (c === right) put(c, r, "\\", 0.3);
          else if (t < 0.27 && snow) put(c, r, hash(c, r) > 0.55 ? "*" : "^", 0.2);
          else put(c, r, hash(c, r) > 0.78 ? "|" : hash(c, r) > 0.4 ? ":" : ".", 0.1);
        }
      }

      // the pagoda on a rock, left of centre-bottom, in front of the sea
      const pgCol = Math.round(C * 0.12);
      const pgTop = horizon - PAGODA.length + 2;
      PAGODA.forEach((line, i) => {
        const c0 = pgCol - Math.floor(line.length / 2);
        for (let j = 0; j < line.length; j++) put(c0 + j, pgTop + i, line[j], i === PAGODA.length - 1 ? 0.26 : 0.3);
      });
      for (let k = 1; k <= 3; k++) {
        const half = 14 - k * 2;
        for (let c = pgCol - half; c <= pgCol + half; c++) put(c, horizon + k - 1, hash(c, k) > 0.5 ? "#" : "%", 0.2 - k * 0.03);
      }

      // vertical kanji
      for (const col of COLUMNS) {
        const c = Math.round(C * col.x);
        const r0 = Math.round(R * col.y);
        [...col.text].forEach((g, i) => put(c, r0 + i, g, col.a, col.tint));
      }

      // paint the still layer once
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const o = off.getContext("2d")!;
      o.textBaseline = "alphabetic";
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const cell = grid[r][c];
          if (!cell) continue;
          const wide = cell.ch.charCodeAt(0) > 0x2e80;
          o.font = wide ? `${fs * 1.02}px ${CJK}` : `${fs}px ${FONT}`;
          const [rr, gg, bb] = TINTS[cell.tint];
          o.fillStyle = `rgba(${rr},${gg},${bb},${(cell.a * STRENGTH).toFixed(3)})`;
          o.fillText(cell.ch, c * cw + (wide ? -cw * 0.25 : 0), (r + 0.82) * ch);
        }
      }
      still = off;

      petals = Array.from({ length: Math.max(14, Math.round(C / 5)) }, (_, i) => ({
        x: hash(i, 1) * C,
        y: hash(i, 2) * R,
        vx: -(0.15 + hash(i, 3) * 0.5),
        vy: 0.7 + hash(i, 4) * 1.1,
        ph: hash(i, 5) * 6.28,
        ch: ["*", ".", "'", "o", "*"][i % 5],
        pink: i % 3 !== 0,
      }));
    };

    const draw = (t: number, moving: boolean) => {
      if (!still) return;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(still, 0, 0);
      ctx.textBaseline = "alphabetic";
      ctx.font = `${fs}px ${FONT}`;

      // waves rolling in, with the sun's path in brass
      for (let r = horizon + 1; r < R; r++) {
        const k = (r - horizon) / Math.max(1, R - horizon);
        for (let c = 0; c < C; c++) {
          const v = Math.sin(c * 0.33 + (moving ? t * (0.5 + k * 1.1) : 0) + r * 1.9) + 0.45 * Math.sin(c * 0.11 - (moving ? t * 0.6 : 0) + r);
          const inPath = Math.abs(c - sunCol) < 2 + k * 15;
          if (v > 0.9) {
            const [rr, gg, bb] = TINTS[inPath ? 1 : 0];
            ctx.fillStyle = `rgba(${rr},${gg},${bb},${((0.1 + 0.2 * k + (inPath ? 0.1 : 0)) * STRENGTH).toFixed(3)})`;
            ctx.fillText(inPath ? "=" : "~", c * cw, (r + 0.82) * ch);
          } else if (v > 0.45 && hash(c, r) > 0.5) {
            ctx.fillStyle = `rgba(226,226,232,${(0.07 * STRENGTH).toFixed(3)})`;
            ctx.fillText("-", c * cw, (r + 0.82) * ch);
          }
        }
      }

      // sakura petals falling past
      if (moving) {
        for (const p of petals) {
          const px = p.x + p.vx * t + Math.sin(t * 0.9 + p.ph) * 2.2;
          const py = p.y + p.vy * t;
          const c = ((Math.round(px) % C) + C) % C;
          const r = Math.round(py) % R;
          const [rr, gg, bb] = TINTS[p.pink ? 2 : 0];
          ctx.fillStyle = `rgba(${rr},${gg},${bb},${(0.5 * STRENGTH).toFixed(3)})`;
          ctx.fillText(p.ch, c * cw, (r + 0.82) * ch);
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 70) return; // about 14 frames a second is plenty for text this faint
      last = now;
      draw((now - t0) / 1000, true);
    };

    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        build();
        draw((performance.now() - t0) / 1000, !reduce);
      });
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    build();
    draw(0, false);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
