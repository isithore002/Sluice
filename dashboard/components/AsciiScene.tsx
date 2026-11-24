"use client";

import { useEffect, useRef } from "react";
import create, { meta } from "./scene/sea-torii-sunset.js";

const COLS: number = meta.cols;
const ROWS: number = meta.rows;
const FRAME_MS = 1000 / meta.fps;
const TONE = meta.dots.tone as { gamma: number; floor: number; sat: number };
const BG = "#09070a";
const KEY_ORDER: string[] = Object.keys(meta.palette);
const hexToRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** A palette colour with its saturation eased by the scene's own `sat`, as a CSS colour. */
const toneColor = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const m = (v: number) => Math.round(y + (v - y) * TONE.sat);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
};

/**
 * Draws a text scene as a halftone of round dots. The scene (components/scene) returns, for every cell, a block character
 * whose height says how bright it is and a one-letter colour key; here the height becomes the dot's size and the key its
 * colour. Dots of one colour are drawn in one pass, so a 192 x 108 picture costs about fifty fills a frame.
 * `bare` leaves the size to the caller's CSS (the intro fills the screen with it). It stands still for reduced motion or when the nav's "Pause motion" is on, and sleeps while off screen.
 */
export function AsciiScene({ className, bare = false, maxDpr = 2 }: { className?: string; bare?: boolean; maxDpr?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frameOf = create() as (t: number) => { text: string; color: string };
    const fills = KEY_ORDER.map((k) => toneColor(meta.palette[k as keyof typeof meta.palette] as string));
    const keyIndex = new Map(KEY_ORDER.map((k, i) => [k.charCodeAt(0), i]));

    let W = 0;
    let H = 0;
    let raf = 0;
    let visible = true;
    let last = 0;
    let clock = reduce ? 4 : 2; // scene time, in seconds; it only advances while the scene is playing
    let drawn = false;
    const buckets: number[][] = KEY_ORDER.map(() => []);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const css = canvas.clientWidth;
      if (!css) return;
      W = Math.round(css * dpr);
      H = Math.round((css * ROWS) / COLS * dpr);
      canvas.width = W;
      canvas.height = H;
      prevT = null; // a resized canvas is blank, so the next frame is drawn whole
      drawn = false;
    };

    let prevT: string[] | null = null;
    let prevC: string[] | null = null;
    const clear: number[] = [];

    const draw = () => {
      if (!W) return;
      const { text, color } = frameOf(clock);
      const tl = text.split("\n");
      const cl = color.split("\n");
      const cell = W / COLS;
      for (const b of buckets) b.length = 0;
      clear.length = 0;
      const full = !prevT || !prevC;
      // Only cells whose size or colour changed since the last frame are cleared and redrawn: the sky, the gate and the rocks
      // stand still, so most of a frame is left as it is.
      for (let y = 0; y < ROWS; y++) {
        const tr = tl[y];
        const cr = cl[y];
        const pt = full ? "" : prevT![y];
        const pc = full ? "" : prevC![y];
        for (let x = 0; x < COLS; x++) {
          const tc = tr.charCodeAt(x);
          const cc = cr.charCodeAt(x);
          if (!full && tc === pt.charCodeAt(x) && cc === pc.charCodeAt(x)) continue;
          if (!full) clear.push(x * cell, y * cell);
          const lv = tc - 0x2581; // ▁ is 0 and █ is 7
          const ki = keyIndex.get(cc);
          if (ki === undefined || lv < 0) continue;
          const s = Math.pow((lv + 1) / 8, TONE.gamma);
          const r = cell * 0.5 * (TONE.floor + (1 - TONE.floor) * s);
          buckets[ki].push((x + 0.5) * cell, (y + 0.5) * cell, r);
        }
      }
      prevT = tl;
      prevC = cl;
      ctx.fillStyle = BG;
      if (full) {
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.beginPath();
        for (let i = 0; i < clear.length; i += 2) ctx.rect(clear[i], clear[i + 1], cell, cell);
        ctx.fill();
      }
      for (let k = 0; k < buckets.length; k++) {
        const b = buckets[k];
        if (!b.length) continue;
        ctx.fillStyle = fills[k];
        ctx.beginPath();
        for (let i = 0; i < b.length; i += 3) {
          ctx.moveTo(b[i] + b[i + 2], b[i + 1]);
          ctx.arc(b[i], b[i + 1], b[i + 2], 0, Math.PI * 2);
        }
        ctx.fill();
      }
      drawn = true;
    };

    const paused = () => document.documentElement.dataset.motion === "paused";
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || !W) return;
      if (!drawn) {
        draw();
        last = now;
        return;
      }
      if (reduce || paused()) {
        last = now;
        return;
      }
      const dt = now - last;
      if (dt < FRAME_MS) return;
      clock += Math.min(dt, 250) / 1000;
      last = now;
      draw();
    };

    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      last = performance.now();
    });
    io.observe(canvas);
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label="A shrine gate standing in the sea as the sun sets between its posts, with waves rolling in and gulls crossing the sky"
      style={bare ? undefined : { display: "block", width: "100%", aspectRatio: `${COLS} / ${ROWS}` }}
    />
  );
}
