"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "./LogoMark";
import Lenis from "lenis";
import ShapeGrid from "./ui/ShapeGrid";

export interface NavLink {
  href: string;
  label: string;
}

const GITHUB = "https://github.com/isithore002/Sluice";

function NavItem({ l }: { l: NavLink }) {
  if (l.href.startsWith("http")) {
    return (
      <a href={l.href} target="_blank" rel="noreferrer">
        {l.label}
      </a>
    );
  }
  if (l.href.startsWith("#")) return <a href={l.href}>{l.label}</a>;
  return <Link href={l.href}>{l.label}</Link>;
}

const MOTION_KEY = "sluice-bg-paused";

/**
 * The frame both pages share, so they look and behave like one product: the drifting grid background (with a control
 * to pause it), sticky nav, footer, the pointer light on cards, and the `js` flag that arms scroll reveals.
 */
export function SiteShell({ links, cta, children }: { links: NavLink[]; cta: NavLink; children: ReactNode }) {
  const [js, setJs] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setJs(true);
    try {
      setPaused(window.localStorage.getItem(MOTION_KEY) === "1");
    } catch {
      /* the choice just isn't remembered */
    }
  }, []);
  // Other motion on the page (the hero scene) follows the same pause control.
  useEffect(() => {
    document.documentElement.dataset.motion = paused ? "paused" : "";
  }, [paused]);
  // Smooth, inertial scrolling. Off for reduced motion; in-page anchors glide too.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true, anchors: { offset: -64 } });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  const togglePaused = () =>
    setPaused((p) => {
      try {
        window.localStorage.setItem(MOTION_KEY, p ? "0" : "1");
      } catch {
        /* the choice just isn't remembered */
      }
      return !p;
    });

  // Cards follow the pointer with a soft spotlight.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(".sl-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div className={`site${js ? " js" : ""}`}>
      <div className="sl-bg" aria-hidden="true">
        <ShapeGrid
          shape="square"
          cellSize={56}
          lineWidth={1}
          direction="diagonal"
          speed={0.16}
          lineColor="#1a1a1d"
          hoverColor="#e8e8ec"
          hoverFillColor="#c8c8ce"
          fillOpacity={0.12}
          radius={1.9}
          trail={0.9}
          glow={0.3}
          fade={0}
          clickCascade={false}
          paused={paused}
        />
      </div>

      <div className="sl-progress" aria-hidden="true" />
      <nav className="sl-nav" aria-label="Main">
        <div className="sl-nav-in">
          <Link href="/" className="sl-brand">
            <LogoMark size={26} />
            Sluice
          </Link>
          <div className="sl-links">
            {links.map((l) => (
              <NavItem key={l.href + l.label} l={l} />
            ))}
            <button type="button" className="sl-motion" onClick={togglePaused} aria-pressed={paused} aria-label={paused ? "Play background motion" : "Pause background motion"}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                {paused ? <path d="M3 1.8v8.4L10 6z" fill="currentColor" /> : <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />}
              </svg>
              <span>{paused ? "Play motion" : "Pause motion"}</span>
            </button>
            <Link href={cta.href} className="sl-pill">
              {cta.label}
            </Link>
          </div>
        </div>
      </nav>

      {children}

      <footer className="sl-foot-bar sl-wrap">
        <p>Built for the Reactive Omni Buildathon, Every Second Counts track. A testnet demo, staged by us.</p>
        <p className="sl-fine">Sluice is an independent hackathon project built on Reactive Omni. The mark shown belongs to Reactive Network.</p>
        <nav aria-label="Footer">
          <Link href="/">Home</Link>
          <Link href="/dashboard">Live dashboard</Link>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </nav>
      </footer>
    </div>
  );
}
