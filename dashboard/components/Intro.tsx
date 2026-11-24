"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AsciiScene } from "./AsciiScene";
import * as dawn from "./scene/fuji-dawn-lake.js";
import { drawFigure, FIGURE_H } from "./intro/figure";
import { createFootsteps } from "./intro/footsteps";
import {
  cloudCells,
  CLOUD_CENTER,
  CLOUD_COLORS,
  CLOUD_H,
  CLOUD_W,
  MESSAGE_H,
  MESSAGE_W,
  SPEECH_CHARS,
  speechLayout,
  type CloudCell,
} from "./intro/pixelart";

const COLS = 192; // the scene's size, in cells
const ROWS = 108;
// The scroll transition is a match cut between the two scenes, which both have a sun. In order, over the scroll `p` (0 to 1):
//   0   to 0.46  the camera dives into the sunset's sun until the sun fills the screen, and the screen flushes to its cream
//   0.46 to 0.62 the cream clears out of the dawn scene's sun, which fills the screen first
//   0.50 to 0.90 the camera pulls back from that sun to reveal the whole lake
//   0.84 to 1    the lake dims to its quiet place behind the hero text, which then scrolls in
const SUN_A = { col: 96, row: 51, r: 8 }; // the sunset's sun, in scene cells
const SUN_B = { col: 150, row: 50, r: 6.5 }; // the dawn scene's sun
const P_PEAK = 0.46;
const REST_OPACITY = 0.22; // how faint the dawn scene is behind the hero

// The story, in seconds from the page opening.
const T_WALK = 0.9; // the man starts walking in
const WALK_S = 4.4; // and takes this long to get to his spot
const T_TALK = T_WALK + WALK_S + 0.5; // then the cloud pops out of his mouth
const POP_S = 0.45;
const TYPE_CPS = 11; // letters per second
const UNLOCK_AFTER = 0.6; // seconds after the last letter before scrolling is allowed
const AUTO_START = 8; // the story begins on the first click or key press; if nobody does either, it starts by itself after this long

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
 * The hero is passed in as `children`: the pinned stage stays behind it, so the dawn scene becomes the hero's own background.
 */
export function Intro({ children }: { children?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const artB = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const cvA = useRef<HTMLDivElement>(null);
  const cvB = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const progress = useRef(0);
  const unlockRef = useRef<() => void>(() => {});
  const fx = useRef<ReturnType<typeof createFootsteps> | null>(null);

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
    const safety = window.setTimeout(() => unlock(), 30000);
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

  // Footsteps, always on. Browsers let a page make sound only after the visitor has interacted with it, so they play whenever the
  // browser allows it: at once if the visitor has already interacted with this site, otherwise from their first click, tap or key press.
  useEffect(() => {
    const f = createFootsteps();
    fx.current = f;
    const names = ["pointerdown", "keydown", "touchstart", "click"];
    const onGesture = () => {
      void f.resume().then((ok) => {
        if (ok) for (const n of names) window.removeEventListener(n, onGesture);
      });
    };
    if (f.mayAutoplay()) void f.resume();
    for (const n of names) window.addEventListener(n, onGesture, { passive: true });
    return () => {
      for (const n of names) window.removeEventListener(n, onGesture);
      f.close();
    };
  }, []);

  // Size the pictures to cover the stage, and turn scrolling into the transition.
  useEffect(() => {
    const sp = spacer.current;
    const st = stage.current;
    const a = art.current;
    const b = artB.current;
    const fl = flash.current;
    if (!sp || !st || !a || !b || !fl) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cell = 8;
    let zoomA = 10; // how far each picture is magnified when its sun fills the screen
    let zoomB = 12;
    let boxW = 0;
    let boxH = 0;
    const size = () => {
      boxW = st.clientWidth;
      boxH = st.clientHeight;
      cell = Math.max(boxW / COLS, boxH / ROWS);
      st.style.setProperty("--cell", `${cell}px`);
      const half = Math.hypot(boxW, boxH) / 2;
      zoomA = (half / (SUN_A.r * cell)) * 1.08;
      zoomB = (half / (SUN_B.r * cell)) * 1.08;
      // each picture turns about its own sun
      a.style.transformOrigin = `${boxW / 2 + (SUN_A.col - COLS / 2) * cell}px ${boxH / 2 + (SUN_A.row - ROWS / 2) * cell}px`;
      b.style.transformOrigin = `${boxW / 2 + (SUN_B.col - COLS / 2) * cell}px ${boxH / 2 + (SUN_B.row - ROWS / 2) * cell}px`;
    };
    /** magnification `s` of a picture about its sun, panned so the sun sits at the middle of the screen when fully magnified */
    const camera = (sun: { col: number; row: number }, s: number, max: number) => {
      const k = max > 1 ? (s - 1) / (max - 1) : 0;
      const tx = -(sun.col - COLS / 2) * cell * k;
      const ty = -(sun.row - ROWS / 2) * cell * k;
      return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
    };
    const apply = () => {
      const r = sp.getBoundingClientRect();
      const p = clamp01(-r.top / Math.max(1, sp.offsetHeight - st.clientHeight));
      progress.current = p;
      let opA: number;
      let opB: number;
      let cream: number;
      if (reduce) {
        // no camera: the sunset simply gives way to the dawn
        a.style.transform = "none";
        b.style.transform = "none";
        const x = smooth(0.25, 0.6, p);
        opA = 1 - x;
        opB = x * (1 - (1 - REST_OPACITY) * smooth(0.6, 1, p));
        cream = 0;
      } else {
        const ua = clamp01(p / P_PEAK);
        a.style.transform = camera(SUN_A, Math.exp(Math.log(zoomA) * Math.pow(ua, 1.8)), zoomA);
        const ub = clamp01((p - 0.5) / 0.4);
        const eb = 1 - Math.pow(1 - ub, 2.2);
        b.style.transform = camera(SUN_B, Math.exp(Math.log(zoomB) * (1 - eb)), zoomB);
        opA = p < P_PEAK ? 1 : 0;
        opB = p < P_PEAK - 0.02 ? 0 : 1 - (1 - REST_OPACITY) * smooth(0.84, 1, p);
        cream = p < P_PEAK ? smooth(0.3, P_PEAK, p) : 1 - smooth(0.48, 0.62, p);
      }
      a.style.opacity = opA.toFixed(3);
      b.style.opacity = opB.toFixed(3);
      fl.style.opacity = cream.toFixed(3);
      // a picture that cannot be seen sits still, and only the sunset's story needs its stick man
      const idleA = opA === 0 ? "1" : "0";
      const idleB = opB === 0 ? "1" : "0";
      const ca = cvA.current?.querySelector("canvas:not(.intro-over)") as HTMLCanvasElement | null;
      const cb = cvB.current?.querySelector("canvas") as HTMLCanvasElement | null;
      if (ca) ca.dataset.idle = idleA;
      if (cb) cb.dataset.idle = idleB;
      document.documentElement.dataset.intro = p < 0.985 ? "on" : "off";
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
    let pitch = 0; // one sprite pixel of the stick man (he is FIGURE_H of them tall)
    let bpx = 0; // one pixel of the cloud's shape
    let tp = 0; // one pixel of the letters
    let visL = 0; // the part of the canvas the stage shows
    let visT = 0;
    let visW = 0;
    let visH = 0;
    let walkTop = 0;
    let cloud: { key: string; cells: CloudCell[]; maxD: number } | null = null;
    let dirty = true;
    let visible = true;
    let clock = reduce ? 60 : 0; // time since the page opened; it only runs while the page is visible
    let storyStart: number | null = reduce ? 0 : null; // when the story began: the first click or key press (or AUTO_START)
    const begin = () => {
      if (storyStart !== null) return;
      storyStart = clock;
      hint.current?.classList.add("gone");
      void fx.current?.resume(); // the click is also what lets the browser play the footsteps
    };
    if (reduce) hint.current?.classList.add("gone");
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
      pitch = Math.max(2, Math.round(cell * 0.5));
      bpx = Math.max(2, Math.round(cell * 0.4));
      tp = Math.max(2, Math.round(bpx * 0.67));
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

      // the stick man walks in from the left, then stands and talks. His stride is tied to the distance he covers, so his feet
      // never slide, and every footfall (every half turn of the cycle) makes a step sound.
      const walkU = clamp01((t - T_WALK) / WALK_S);
      const startX = visL - 10 * pitch;
      const stopX = visL + visW * 0.28;
      const hipX = startX + (stopX - startX) * walkU;
      const phase = (Math.PI * 2 * (hipX - startX)) / (FIGURE_H * pitch * 0.8);
      const tStop = T_WALK + WALK_S;
      const walkAmt = t < T_WALK ? 0 : t < tStop ? smooth(0, 1, (t - T_WALK) / 0.3) : Math.max(0, 1 - (t - tStop) / 0.4);
      const walking = t >= T_WALK && walkU < 1;
      const talkT = t - T_TALK;
      const typed = talkT > 0.4 ? Math.min(SPEECH_CHARS, Math.floor((talkT - 0.4) * TYPE_CPS)) : 0;
      const talking = talkT > 0.4 && typed < SPEECH_CHARS && Math.floor(t * 8) % 2 === 0;
      const stepIdx = Math.floor(phase / Math.PI);
      if (walking && stepIdx !== lastStep) {
        lastStep = stepIdx;
        fx.current?.step(stepIdx % 2 === 0);
      }
      if (typed >= SPEECH_CHARS && talkT > 0.4 + SPEECH_CHARS / TYPE_CPS + UNLOCK_AFTER) unlockRef.current(); // he has said it: let the visitor scroll
      const { mouth } = drawFigure(ctx, {
        x: Math.round(hipX),
        ground: walkTop + Math.round(cell * 0.9),
        pitch,
        phase,
        walk: walkAmt,
        wave: smooth(0, 1, (talkT - 0.1) / 0.4),
        talking,
        t,
      });

      // the cloud, growing out of his mouth; it folds away as soon as the visitor scrolls
      const q = Math.min(clamp01(talkT / POP_S), 1 - clamp01((p - 0.02) / 0.06));
      if (q <= 0) return;
      let ox = Math.round(mouth.x + 3 * bpx);
      const oy = Math.max(Math.round(visT + 10 * d), Math.round(mouth.y - (CLOUD_H + 8) * bpx));
      ox = Math.min(ox, Math.round(visL + visW - (CLOUD_W + 2) * bpx));
      const ml = { x: (mouth.x - ox) / bpx, y: (mouth.y - oy) / bpx };
      const key = `${Math.round(ml.x * 2)},${Math.round(ml.y * 2)},${bpx}`;
      if (!cloud || cloud.key !== key) cloud = { key, ...cloudCells(ml) };
      const bob = Math.round(Math.sin(t * 2.4) * bpx * 0.7);
      const reach = q * cloud.maxD * 1.05;
      for (const edge of [false, true]) {
        ctx.fillStyle = edge ? CLOUD_COLORS.edge : CLOUD_COLORS.fill;
        for (const c of cloud.cells) if (c.edge === edge && c.d <= reach) ctx.fillRect(ox + c.x * bpx, oy + c.y * bpx + bob, bpx, bpx);
      }
      if (q > 0.9) {
        // the message is centred on the middle of the cloud's body, both ways, in whole pixels
        const bx = Math.round(ox + CLOUD_CENTER.x * bpx - (MESSAGE_W * tp) / 2);
        const by = Math.round(oy + bob + CLOUD_CENTER.y * bpx - (MESSAGE_H * tp) / 2);
        const { text, chevron } = speechLayout(typed);
        ctx.fillStyle = CLOUD_COLORS.ink;
        for (const px of text) ctx.fillRect(bx + Math.round(px.x * tp), by + Math.round(px.y * tp), tp, tp);
        if (chevron.length) {
          const hop = (Math.floor(t * 3) % 2) * tp;
          ctx.fillStyle = CLOUD_COLORS.arrow;
          for (const px of chevron) ctx.fillRect(bx + Math.round(px.x * tp), by + Math.round(px.y * tp) + hop, tp, tp);
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || !CW) {
        last = now;
        return;
      }
      const dt = now - last;
      const p = progress.current;
      const playing = !reduce;
      if (p >= P_PEAK && !dirty) {
        last = now;
        return; // the sunset is out of sight, so there is nothing to animate
      }
      if (!dirty && p === lastP && (!playing || dt < 16)) return;
      if (playing) clock += Math.min(dt, 250) / 1000;
      if (storyStart === null && clock >= AUTO_START) begin();
      last = now;
      lastP = p;
      dirty = false;
      draw(storyStart === null ? -1 : clock - storyStart, p);
    };

    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    ro.observe(cv);
    ro.observe(st);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      last = performance.now();
    });
    io.observe(st);
    const startNames = ["pointerdown", "keydown", "touchstart", "click"];
    for (const n of startNames) window.addEventListener(n, begin, { passive: true });
    layout();
    raf = requestAnimationFrame(loop);
    return () => {
      for (const n of startNames) window.removeEventListener(n, begin);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div ref={wrap} className="intro">
      <a className="sr-only intro-skip" href="#how" onClick={() => unlockRef.current()}>
        Skip the introduction
      </a>
      <div ref={stage} className="intro-stage">
        <div ref={artB} className="intro-art b" style={{ opacity: 0 }}>
          <div ref={cvB} className="intro-cv">
            <AsciiScene
              className="intro-fill"
              bare
              maxDpr={1.25}
              scene={dawn as never}
              transparent
              label="A snow-capped volcano glowing pink at dawn over a still lake, with a small boat poling across"
            />
          </div>
        </div>
        <div ref={art} className="intro-art a">
          <div ref={cvA} className="intro-cv">
            <AsciiScene className="intro-fill" bare maxDpr={1.5} />
          </div>
          <canvas ref={over} className="intro-cv intro-over" aria-hidden="true" />
        </div>
        <div ref={flash} className="intro-flash" aria-hidden="true" />
        <p ref={hint} className="intro-hint">
          Click anywhere to start
        </p>
      </div>
      <div ref={spacer} className="intro-spacer" aria-hidden="true" />
      {children}
    </div>
  );
}
