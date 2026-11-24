"use client";

import { useEffect, useRef } from "react";
import * as torii from "./scene/sea-torii-sunset.js";

const BG = "#09070a";
const hexToRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

type SceneModule = { default: () => unknown; meta: { cols: number; rows: number; fps: number; palette: Record<string, string>; dots: { tone: unknown } } };

/**
 * Draws a text scene as a halftone of round dots. The scene (components/scene) returns, for every cell, a block character
 * whose height says how bright it is and a one-letter colour key; here the height becomes the dot's size and the key its
 * colour. Dots of one colour are drawn in one pass, so a 192 x 108 picture costs about fifty fills a frame.
 * Setting data-idle="1" on the canvas puts it to sleep once its first frame is drawn. `bare` leaves the size to the caller's CSS (the intro fills the screen with it). It stands still for reduced motion, and sleeps while off screen.
 */
export function AsciiScene({
  className,
  bare = false,
  maxDpr = 2,
  scene = torii as unknown as SceneModule,
  transparent = false,
  label = "A shrine gate standing in the sea as the sun sets between its posts, with waves rolling in and gulls crossing the sky",
}: {
  className?: string;
  bare?: boolean;
  maxDpr?: number;
  /** The scene module to draw (default: the sunset torii). */
  scene?: SceneModule;
  /** Clear to transparent instead of painting a dark background, so the page behind shows through. */
  transparent?: boolean;
  label?: string;
}) {
  const { meta } = scene;
  const COLS = meta.cols;
  const ROWS = meta.rows;
  const FRAME_MS = 1000 / meta.fps;
  const TONE = meta.dots.tone as { gamma: number; floor: number; sat: number };
  const KEY_ORDER = Object.keys(meta.palette);
  /** A palette colour with its saturation eased by the scene's own `sat`, as a CSS colour. */
  const toneColor = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const m = (v: number) => Math.round(y + (v - y) * TONE.sat);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  };
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frameOf = scene.default() as (t: number) => { text: string; color: string };
    const fills = KEY_ORDER.map((k) => toneColor(meta.palette[k]));
    const keyIndex = new Map(KEY_ORDER.map((k, i) => [k.charCodeAt(0), i]));

    let W = 0;
    let H = 0;
    let raf = 0;
    let visible = true;
    let last = 0;
    let clock = reduce ? 4 : 2; // scene time, in seconds; it only advances while the scene is playing
    let drawn = false;
    let scrolling = false; // the scene rests while the page is scrolling, so the scroll has the main thread to itself
    let scrollTimer = 0;
    const onScroll = () => {
      scrolling = true;
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrolling = false;
        last = performance.now();
      }, 140);
    };
    const buckets: number[][] = KEY_ORDER.map(() => []);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      // the picture is as wide as the box needs it to be to cover it (a tall box makes it wider than the box, and CSS crops it)
      const css = Math.max(canvas.clientWidth, (canvas.clientHeight * COLS) / ROWS);
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
        if (transparent) ctx.clearRect(0, 0, W, H);
        else ctx.fillRect(0, 0, W, H);
      } else if (transparent) {
        for (let i = 0; i < clear.length; i += 2) ctx.clearRect(clear[i], clear[i + 1], cell, cell);
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

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || !W) return;
      if (!drawn) {
        draw();
        last = now;
        return;
      }
      if (reduce || scrolling || canvas.dataset.idle === "1") {
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
    window.addEventListener("scroll", onScroll, { passive: true });
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frame);
      window.clearTimeout(scrollTimer);
      window.removeEventListener("scroll", onScroll);
      ro.disconnect();
      io.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label={label}
      style={bare ? undefined : { display: "block", width: "100%", aspectRatio: `${COLS} / ${ROWS}` }}
    />
  );
}
