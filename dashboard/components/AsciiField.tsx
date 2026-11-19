"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/\\|[](){}*+-=_:;.,!?#$%&@^~";
const CELL_W = 15;
const CELL_H = 22;
const LEVELS = 8;
/** Grey, cyan, near-white. Each class has LEVELS+1 alpha steps so cells can be drawn in a few batches. */
const RGB = ["138,144,160", "56,189,248", "232,247,255"];
const STYLES = RGB.map((rgb) => Array.from({ length: LEVELS + 1 }, (_, q) => `rgba(${rgb},${(q / LEVELS).toFixed(3)})`));

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Full-viewport field of scattered monospace glyphs, dense at the edges and quiet in the middle, with a faint
 * row of block ticks along the bottom. Patches slowly breathe, glyphs flicker, and glyphs near the pointer light up
 * and scramble. Elements marked `data-ascii-avoid` (optionally with a strength 0..1, and `data-ascii-pad` for the falloff distance in px) get a quiet halo behind them
 * so text stays readable. Drawn on a 2D canvas in a handful of batched fillText calls per frame.
 */
export function AsciiField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, cols = 0, rows = 0, cells = 0;
    let glyph = new Uint8Array(0);
    let rnd = new Float32Array(0);
    let tone = new Uint8Array(0); // 0 grey, 1 cyan
    let mask = new Float32Array(0); // 0..1 multiplier from avoid elements
    let maskDirty = true;
    const pointer = { x: -9999, y: -9999 };
    const buckets: number[][] = Array.from({ length: 3 * (LEVELS + 1) }, () => []);

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `13px ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      cells = cols * rows;
      glyph = new Uint8Array(cells);
      rnd = new Float32Array(cells);
      tone = new Uint8Array(cells);
      mask = new Float32Array(cells).fill(1);
      for (let i = 0; i < cells; i++) {
        const u = (i % cols) / cols;
        const v = Math.floor(i / cols) / rows;
        glyph[i] = Math.floor(Math.random() * GLYPHS.length);
        rnd[i] = Math.random();
        tone[i] = Math.random() < (u < 0.32 && v < 0.55 ? 0.55 : 0.07) ? 1 : 0;
      }
      maskDirty = true;
    };

    const rebuildMask = () => {
      const rects = Array.from(document.querySelectorAll<HTMLElement>("[data-ascii-avoid]")).map((el) => ({
        r: el.getBoundingClientRect(),
        s: clamp01(parseFloat(el.dataset.asciiAvoid || "") || 0.8),
        pad: parseFloat(el.dataset.asciiPad || "") || 70,
      }));
      for (let i = 0; i < cells; i++) {
        const x = (i % cols) * CELL_W + CELL_W / 2;
        const y = Math.floor(i / cols) * CELL_H + CELL_H / 2;
        let m = 1;
        for (const { r, s, pad } of rects) {
          if (r.bottom < -pad || r.top > h + pad) continue;
          const dx = Math.max(r.left - x, 0, x - r.right);
          const dy = Math.max(r.top - y, 0, y - r.bottom);
          const f = clamp01(Math.hypot(dx, dy) / pad);
          m *= 1 - s * (1 - f * f * (3 - 2 * f)); // smoothstep falloff, so the quiet zone has no visible edge
        }
        mask[i] = m;
      }
      maskDirty = false;
    };

    const draw = (t: number) => {
      if (maskDirty) rebuildMask();
      for (const b of buckets) b.length = 0;

      const narrow = w < 800 ? 0.65 : 1;
      const scrollFade = 1 - 0.55 * clamp01(window.scrollY / (h * 0.9));
      const alphaScale = narrow * scrollFade;
      const tickRow0 = Math.floor(rows * 0.8);
      const PR = 110;

      if (!reduce) {
        for (let k = Math.ceil(cells * 0.006); k > 0; k--) {
          const i = (Math.random() * cells) | 0;
          glyph[i] = (Math.random() * GLYPHS.length) | 0;
          rnd[i] = Math.random();
        }
      }

      for (let i = 0; i < cells; i++) {
        const col = i % cols;
        const row = (i / cols) | 0;
        const u = col / cols;
        const v = row / rows;
        let cls = tone[i];
        let a: number;
        let ch = glyph[i];

        if (row >= tickRow0 && row % 2 === 0 && col % 4 === 1) {
          // Block ticks along the bottom, with a pulse sweeping across them.
          ch = GLYPHS.indexOf("|");
          const wave = 0.5 + 0.5 * Math.sin(col * 0.22 - t * 1.5);
          a = 0.1 + 0.26 * wave * wave * wave;
        } else {
          const n =
            0.5 +
            0.25 * Math.sin(u * 9 + t * 0.12) * Math.sin(v * 6.5 - t * 0.09) +
            0.15 * Math.sin(u * 23 + v * 13 + t * 0.2) +
            0.2 * Math.sin(u * 4.1 - v * 8.7 + t * 0.07);
          const edge = Math.max(clamp01(1 - u / 0.3), clamp01(1 - (1 - u) / 0.45), clamp01(1 - v / 0.35));
          a = smooth(0.4, 0.82, n) * (0.35 + 0.65 * edge) * (0.4 + 0.6 * rnd[i]) * 1.25;
        }
        a *= mask[i] * alphaScale;

        const dx = (col + 0.5) * CELL_W - pointer.x;
        const dy = (row + 0.5) * CELL_H - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < PR * PR) {
          const f = 1 - Math.sqrt(d2) / PR;
          a = Math.max(a, 0.2 + 0.7 * f);
          cls = f > 0.55 ? 2 : 1;
          if (!reduce && Math.random() < 0.1 * f) glyph[i] = (Math.random() * GLYPHS.length) | 0;
        }

        const q = Math.round(a * LEVELS);
        if (q > 0) buckets[cls * (LEVELS + 1) + Math.min(q, LEVELS)].push(i, ch);
      }

      ctx.clearRect(0, 0, w, h);
      for (let b = 0; b < buckets.length; b++) {
        const list = buckets[b];
        if (!list.length) continue;
        ctx.fillStyle = STYLES[Math.floor(b / (LEVELS + 1))][b % (LEVELS + 1)];
        for (let j = 0; j < list.length; j += 2) {
          const i = list[j];
          ctx.fillText(GLYPHS[list[j + 1]], (i % cols) * CELL_W + CELL_W / 2, ((i / cols) | 0) * CELL_H + CELL_H / 2);
        }
      }
    };

    layout();
    const t0 = performance.now();
    let raf = 0;
    let lastDraw = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastDraw < 33) return; // ~30 fps is plenty for this texture
      lastDraw = now;
      draw((now - t0) / 1000);
    };

    const markDirty = () => {
      maskDirty = true;
      if (reduce) draw(0);
    };
    const onResize = () => {
      layout();
      if (reduce) draw(0);
    };
    const onMove = (e: PointerEvent) => {
      // No pointer glow over elements marked data-ascii-calm (the 3D logo), where it would show through the artwork.
      const calm = (e.target as Element | null)?.closest?.("[data-ascii-calm]");
      pointer.x = calm ? -9999 : e.clientX;
      pointer.y = calm ? -9999 : e.clientY;
    };
    const onLeave = () => {
      pointer.x = pointer.y = -9999;
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", markDirty, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    const layoutTimer = window.setInterval(() => (maskDirty = true), 600); // content can shift after data loads

    if (reduce) draw(0);
    else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(layoutTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", markDirty);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
