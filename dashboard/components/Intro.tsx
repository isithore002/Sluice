"use client";

import { useEffect, useRef, useState } from "react";
import { AsciiScene } from "./AsciiScene";
import { createFootsteps } from "./intro/footsteps";
import {
  buildMan,
  chevronAt,
  CHEVRON,
  cloudCells,
  CLOUD_COLORS,
  CLOUD_H,
  CLOUD_W,
  MAN_H,
  MAN_W,
  MOUTH_COL,
  MOUTH_ROW,
  SPEECH_CHARS,
  speechPixels,
  TEXT_CX,
  TEXT_Y0,
  type CloudCell,
} from "./intro/pixelart";

const COLS = 192; // the scene's size, in cells
const ROWS = 108;
const ZOOM = 5.5; // how far the picture rushes in, toward the sun, as the visitor scrolls

// The story, in seconds from the page opening.
const T_WALK = 0.9; // the man starts walking in
const WALK_S = 4.4; // and takes this long to get to his spot
const T_TALK = T_WALK + WALK_S + 0.5; // then the cloud pops out of his mouth
const POP_S = 0.45;
const TYPE_CPS = 11; // letters per second
const UNLOCK_AFTER = 0.6; // seconds after the last letter before scrolling is allowed
const SOUND_KEY = "sluice-intro-sound";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * The first thing a visitor sees: the sunset scene fills the screen, a stick man walks in along a boardwalk and a cloud pops
 * out of his mouth telling them to scroll. As they scroll, the picture zooms in toward the sun and fades, and the site is
 * underneath it. The nav stays out of the way until the zoom is nearly done. The scene is a sticky stage inside a taller
 * section, so the scrolling drives the zoom. Scrolling is held until the stick man has finished speaking (see the lock below).
 */
export function Intro() {
  const wrap = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const soundBtn = useRef<HTMLButtonElement>(null);
  const progress = useRef(0);
  const unlockRef = useRef<() => void>(() => {});
  const fx = useRef<ReturnType<typeof createFootsteps> | null>(null);
  const [sound, setSound] = useState<"idle" | "on" | "off">("idle");

  // Hold the page still until the stick man has said his piece. The wheel, touch and keys are caught before anything else sees
  // them, so neither the browser nor the smooth-scroll library moves the page; `unlock` is called when he finishes (or after a
  // safety delay, so a visitor can never be stuck).
  useEffect(() => {
    const w = wrap.current;
    if (!w || window.scrollY > 40) return; // arrived part-way down, say after a reload: nothing to wait for
    const root = document.documentElement;
    let on = true;
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const keys = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "End", "Home"]);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (keys.has(e.key) && !t?.closest("input, textarea, select, [contenteditable]")) e.preventDefault();
    };
    root.classList.add("intro-locked");
    w.setAttribute("data-lenis-prevent", "");
    window.addEventListener("wheel", block, { passive: false, capture: true });
    window.addEventListener("touchmove", block, { passive: false, capture: true });
    window.addEventListener("keydown", onKey);
    const safety = window.setTimeout(() => unlock(), 18000);
    function unlock() {
      if (!on) return;
      on = false;
      window.clearTimeout(safety);
      root.classList.remove("intro-locked");
      w?.removeAttribute("data-lenis-prevent");
      window.removeEventListener("wheel", block, { capture: true });
      window.removeEventListener("touchmove", block, { capture: true });
      window.removeEventListener("keydown", onKey);
    }
    unlockRef.current = unlock;
    return unlock;
  }, []);

  // Footsteps. Browsers allow sound only after the visitor has interacted, so it starts on the first click, tap or key press
  // (or at once if they already have), and the button lets them turn it off.
  useEffect(() => {
    const f = createFootsteps();
    fx.current = f;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(SOUND_KEY);
    } catch {
      /* the choice just isn't remembered */
    }
    if (stored === "off") {
      f.setMuted(true);
      setSound("off");
      return () => f.close();
    }
    const enable = async () => {
      const ok = await f.resume();
      if (ok) setSound("on");
      return ok;
    };
    const onGesture = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(".intro-sound")) return; // the button handles its own clicks
      void enable().then((ok) => {
        if (ok) for (const n of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(n, onGesture);
      });
    };
    if (f.mayAutoplay()) void enable();
    for (const n of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(n, onGesture, { passive: true });
    return () => {
      for (const n of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(n, onGesture);
      f.close();
    };
  }, []);

  const toggleSound = async () => {
    const f = fx.current;
    if (!f) return;
    let next: "idle" | "on" | "off";
    if (sound === "on") {
      f.setMuted(true);
      next = "off";
    } else {
      f.setMuted(false);
      next = (await f.resume()) ? "on" : "idle";
    }
    setSound(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next === "off" ? "off" : "on");
    } catch {
      /* the choice just isn't remembered */
    }
  };

  // Size the picture to cover the stage, and turn scrolling into the zoom.
  useEffect(() => {
    const w = wrap.current;
    const st = stage.current;
    const a = art.current;
    if (!w || !st || !a) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = () => st.style.setProperty("--cell", `${Math.max(st.clientWidth / COLS, st.clientHeight / ROWS)}px`);
    const apply = () => {
      const r = w.getBoundingClientRect();
      const p = clamp01(-r.top / Math.max(1, w.offsetHeight - st.clientHeight));
      progress.current = p;
      const e = easeInOut(p);
      a.style.transform = reduce ? "none" : `scale(${Math.exp(Math.log(ZOOM) * e).toFixed(4)})`;
      a.style.opacity = String((1 - smooth(0.5, 0.95, p)).toFixed(3));
      document.documentElement.dataset.intro = p < 0.92 ? "on" : "off";
      if (soundBtn.current) {
        soundBtn.current.style.opacity = String((1 - smooth(0, 0.12, p)).toFixed(3));
        soundBtn.current.style.pointerEvents = p > 0.12 ? "none" : "auto";
      }
    };
    size();
    apply();
    const onResize = () => {
      size();
      apply();
    };
    window.addEventListener("scroll", apply, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", apply);
      window.removeEventListener("resize", onResize);
      delete document.documentElement.dataset.intro;
    };
  }, []);

  // The boardwalk, the man and his cloud, painted on a canvas the same size as the scene so they share its cells.
  useEffect(() => {
    const cv = over.current;
    const st = stage.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !st || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let d = 1;
    let CW = 0;
    let CH = 0;
    let cell = 0; // one scene cell, in device px
    let spx = 0; // one pixel of the stick man
    let bpx = 0; // one pixel of the cloud and its letters
    let visL = 0; // the part of the canvas the stage shows
    let visT = 0;
    let visW = 0;
    let visH = 0;
    let walkTop = 0;
    let cloud: { key: string; cells: CloudCell[]; maxD: number } | null = null;
    let dirty = true;
    let visible = true;
    const startPaused = document.documentElement.dataset.motion === "paused";
    let clock = reduce || startPaused ? 60 : 0; // the story's time; it only runs while the page is visible and not paused. Reduced motion or a saved pause starts at the end
    let lastStep = -1;
    let last = performance.now();
    let lastP = -1;
    let raf = 0;

    const layout = () => {
      d = Math.min(window.devicePixelRatio || 1, 2);
      const cw = cv.clientWidth;
      if (!cw) return;
      CW = Math.round(cw * d);
      CH = Math.round(cv.clientHeight * d);
      cv.width = CW;
      cv.height = CH;
      const sw = st.clientWidth * d;
      const sh = st.clientHeight * d;
      visL = (CW - sw) / 2;
      visT = (CH - sh) / 2;
      visW = sw;
      visH = sh;
      cell = CW / COLS;
      spx = Math.max(2, Math.round(cell * 0.6));
      bpx = Math.max(2, Math.round(cell * 0.4));
      walkTop = Math.round(visT + visH - 7 * cell);
      cloud = null;
      dirty = true;
    };

    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };

    const draw = (t: number, p: number) => {
      ctx.clearRect(0, 0, CW, CH);

      // the boardwalk along the bottom
      const lip = Math.max(2, Math.round(cell * 0.9));
      rect(0, walkTop, CW, CH - walkTop, "#2a0c12");
      rect(0, walkTop, CW, lip, "#7a2420");
      rect(0, walkTop + lip, CW, Math.max(1, Math.round(cell * 0.5)), "#1a0a14");
      const seam = Math.max(1, Math.round(cell * 0.45));
      for (let x = Math.round(cell * 6); x < CW; x += Math.round(cell * 11)) rect(x, walkTop + lip, seam, CH - walkTop, "#1a0a14");

      // the stick man walks in from the left, then stands and talks
      const walkU = clamp01((t - T_WALK) / WALK_S);
      const startX = visL - (MAN_W + 2) * spx;
      const stopX = visL + visW * 0.28;
      const mx = Math.round(startX + (stopX - startX) * walkU);
      const walking = t >= T_WALK && walkU < 1;
      const talkT = t - T_TALK;
      const typed = talkT > 0.4 ? Math.min(SPEECH_CHARS, Math.floor((talkT - 0.4) * TYPE_CPS)) : 0;
      const waving = talkT > 0.2;
      const talking = talkT > 0.4 && typed < SPEECH_CHARS && Math.floor(t * 8) % 2 === 0;
      const step = waving ? Math.floor(t * 2.2) : Math.max(0, Math.floor((t - T_WALK) / 0.17));
      const my = walkTop + Math.round(cell * 0.9) - MAN_H * spx;
      if (walking && step !== lastStep) {
        lastStep = step;
        if (step % 2 === 0) fx.current?.step(step % 4 === 0); // a boot lands on every other step
      }
      if (typed >= SPEECH_CHARS && talkT > 0.4 + SPEECH_CHARS / TYPE_CPS + UNLOCK_AFTER) unlockRef.current(); // he has said it: let the visitor scroll
      const man = buildMan({ step, walking, talking, waving });
      for (const px of man) rect(mx + px.x * spx, my + px.y * spx, spx, spx, px.c);

      // the cloud, growing out of his mouth; it folds away as soon as the visitor scrolls
      const q = Math.min(clamp01(talkT / POP_S), 1 - clamp01((p - 0.02) / 0.06));
      if (q <= 0) return;
      const mouthX = mx + (MOUTH_COL + 1.5) * spx;
      const mouthY = my + (MOUTH_ROW + 0.5) * spx;
      let ox = Math.round(mouthX + 4 * bpx);
      const oy = Math.max(Math.round(visT + 10 * d), Math.round(mouthY - (CLOUD_H + 10) * bpx));
      ox = Math.min(ox, Math.round(visL + visW - (CLOUD_W + 2) * bpx));
      const ml = { x: (mouthX - ox) / bpx, y: (mouthY - oy) / bpx };
      const key = `${Math.round(ml.x * 2)},${Math.round(ml.y * 2)},${bpx}`;
      if (!cloud || cloud.key !== key) cloud = { key, ...cloudCells(ml) };
      const bob = Math.round(Math.sin(t * 2.4) * bpx * 0.7);
      const reach = q * cloud.maxD * 1.05;
      for (const edge of [false, true]) {
        ctx.fillStyle = edge ? CLOUD_COLORS.edge : CLOUD_COLORS.fill;
        for (const c of cloud.cells) if (c.edge === edge && c.d <= reach) ctx.fillRect(ox + c.x * bpx, oy + c.y * bpx + bob, bpx, bpx);
      }
      if (q > 0.9) {
        ctx.fillStyle = CLOUD_COLORS.ink;
        for (const px of speechPixels(TEXT_CX, TEXT_Y0, typed)) ctx.fillRect(ox + px.x * bpx, oy + px.y * bpx + bob, bpx, bpx);
        if (typed >= SPEECH_CHARS) {
          const ch = chevronAt(TEXT_CX, TEXT_Y0);
          const hop = Math.floor(t * 3) % 2;
          ctx.fillStyle = CLOUD_COLORS.arrow;
          CHEVRON.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") ctx.fillRect(ox + (ch.x + rx) * bpx, oy + (ch.y + ry + hop) * bpx + bob, bpx, bpx);
          });
        }
      }
    };

    const paused = () => document.documentElement.dataset.motion === "paused";
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || !CW) {
        last = now;
        return;
      }
      const dt = now - last;
      const p = progress.current;
      const playing = !reduce && !paused();
      if (!dirty && p === lastP && (!playing || dt < 33)) return;
      if (playing) clock += Math.min(dt, 250) / 1000;
      last = now;
      lastP = p;
      dirty = false;
      draw(clock, p);
    };

    const ro = new ResizeObserver(layout);
    ro.observe(cv);
    ro.observe(st);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      last = performance.now();
    });
    io.observe(st);
    layout();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <section ref={wrap} className="intro" aria-label="Introduction">
      <a className="sr-only intro-skip" href="#how" onClick={() => unlockRef.current()}>
        Skip the introduction
      </a>
      <div ref={stage} className="intro-stage">
        <div ref={art} className="intro-art">
          <AsciiScene className="intro-cv" bare maxDpr={1.5} />
          <canvas ref={over} className="intro-cv intro-over" aria-hidden="true" />
        </div>
        <button ref={soundBtn} type="button" className="intro-sound" onClick={toggleSound} aria-pressed={sound === "on"}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
            {sound === "on" ? (
              <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            ) : (
              <path d="M11.5 6l3 4m0-4l-3 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            )}
          </svg>
          <span>{sound === "on" ? "Sound on" : sound === "off" ? "Sound off" : "Tap for sound"}</span>
        </button>
      </div>
    </section>
  );
}
