"use client";

import { useEffect, useRef } from "react";
import { WAVE_ART } from "./wave-art";

/** Glyphs from lightest to heaviest. A glyph's place here sets how bright it is drawn. */
const DENSITY = " .'`,:;-_~^\"!i|/\\()[]{}<>+=*?lItrcvxzjfLCJYUOZmwqpdbkhao#MW&8%B@$";
const FONT = '"Consolas", "Menlo", "DejaVu Sans Mono", monospace';
const ROWS = WAVE_ART.length;
const COLS = WAVE_ART[0].length;
const CELL_RATIO = 2; // the art was sampled in cells twice as tall as wide, so it keeps the picture's proportions

const weight = (ch: string) => {
  if (ch === ".") return 0.16; // the dark body of the water
  const i = DENSITY.indexOf(ch);
  return 0.38 + 0.62 * Math.min(1, (i < 0 ? 30 : i) / (DENSITY.length - 1));
};

const make = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/**
 * The hero art: the wave in text, drawn once into two layers (dim and bright). Each frame only composites them, so a slow
 * light band and the pointer can pass over it without redrawing eleven thousand glyphs. It stands still for reduced motion or
 * when the nav's "Pause motion" is on, and sleeps while off screen.
 */
export function AsciiWave({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let dim: HTMLCanvasElement;
    let bright: HTMLCanvasElement;
    let mask: HTMLCanvasElement;
    let spot: HTMLCanvasElement;
    let tc2: CanvasRenderingContext2D;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    const ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: false };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const css = canvas.clientWidth;
      if (!css) return;
      W = Math.round(css * dpr);
      H = Math.round((css * ROWS * CELL_RATIO) / COLS * dpr);
      canvas.width = W;
      canvas.height = H;
      dim = make(W, H);
      bright = make(W, H);
      mask = make(W, H);
      spot = make(W, H);
      tc2 = spot.getContext("2d")!;
      const cw = W / COLS;
      const ch = H / ROWS;
      const px = cw / 0.55; // a monospace glyph is about 0.55 em wide
      for (const [layer, grey, scale] of [[dim, 175, 0.62], [bright, 255, 1]] as const) {
        const g = layer.getContext("2d")!;
        g.font = `bold ${px}px ${FONT}`;
        g.textBaseline = "alphabetic";
        g.setTransform(1, 0, 0, ch / (px * 1.18), 0, 0);
        for (let r = 0; r < ROWS; r++) {
          const line = WAVE_ART[r];
          for (let c = 0; c < COLS; c++) {
            const k = line[c];
            if (k === " ") continue;
            const a = weight(k) * scale;
            g.fillStyle = `rgba(${grey},${grey},${Math.min(255, grey + 6)},${a.toFixed(3)})`;
            g.fillText(k, c * cw, ((r + 0.8) * ch) / (ch / (px * 1.18)));
          }
        }
      }
    };

    const draw = (now: number, still: boolean) => {
      if (!W) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(dim, 0, 0);

      // the bright layer shows through a moving soft band and a pointer glow
      const m = mask.getContext("2d")!;
      m.globalCompositeOperation = "source-over";
      m.clearRect(0, 0, W, H);
      m.drawImage(bright, 0, 0);
      m.globalCompositeOperation = "destination-in";
      const t = (now - t0) / 1000;
      const sweep = still ? 0.18 : ((t % 9) / 9) * 1.7 - 0.35; // 0..1 across the art, with margin either side
      const band = m.createLinearGradient(W * (sweep - 0.28), 0, W * (sweep + 0.28), H);
      band.addColorStop(0, "rgba(0,0,0,0.0)");
      band.addColorStop(0.5, "rgba(0,0,0,0.9)");
      band.addColorStop(1, "rgba(0,0,0,0.0)");
      m.fillStyle = band;
      m.fillRect(0, 0, W, H);
      if (ptr.on) {
        const R = W * 0.16;
        const glow = tc2.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, R);
        glow.addColorStop(0, "rgba(0,0,0,1)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        tc2.globalCompositeOperation = "source-over";
        tc2.clearRect(0, 0, W, H);
        tc2.drawImage(bright, 0, 0);
        tc2.globalCompositeOperation = "destination-in";
        tc2.fillStyle = glow;
        tc2.fillRect(0, 0, W, H);
        m.globalCompositeOperation = "source-over";
        m.drawImage(spot, 0, 0);
      }
      ctx.drawImage(mask, 0, 0);

      // the reveal on load: the art draws in from the left
      const intro = still ? 1 : Math.min(1, t / 1.6);
      if (intro < 1) {
        const e = 1 - Math.pow(1 - intro, 3);
        ctx.globalCompositeOperation = "destination-in";
        const gr = ctx.createLinearGradient(W * (e * 1.3 - 0.3), 0, W * (e * 1.3), 0);
        gr.addColorStop(0, "rgba(0,0,0,1)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over";
      }
    };

    const paused = () => document.documentElement.dataset.motion === "paused";
    let drewStill = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      if (reduce || paused()) {
        if (!drewStill) {
          draw(now, true);
          drewStill = true;
        }
        return;
      }
      drewStill = false;
      ptr.x += (ptr.tx - ptr.x) * 0.16;
      ptr.y += (ptr.ty - ptr.y) * 0.16;
      draw(now, false);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left - 60 && e.clientX <= r.right + 60 && e.clientY >= r.top - 60 && e.clientY <= r.bottom + 60;
      if (!inside) {
        ptr.on = false;
        return;
      }
      const s = W / r.width;
      ptr.tx = (e.clientX - r.left) * s;
      ptr.ty = (e.clientY - r.top) * s;
      if (!ptr.on) {
        ptr.x = ptr.tx;
        ptr.y = ptr.ty;
      }
      ptr.on = true;
    };

    const ro = new ResizeObserver(() => {
      build();
      drewStill = false;
      draw(performance.now(), reduce || paused());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    build();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label="A great wave about to break, drawn in text characters, with a small mountain in the distance"
      style={{ display: "block", width: "100%", aspectRatio: `${COLS} / ${ROWS * CELL_RATIO}` }}
    />
  );
}
