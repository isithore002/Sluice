"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Lenis from "lenis";
import { LogoMark } from "./LogoMark";

export interface NavLink {
  href: string;
  label: string;
}

const GITHUB = "https://github.com/isithore002/Sluice";
const MOTION_KEY = "sluice-bg-paused";

function Tab({ l, active }: { l: NavLink; active: boolean }) {
  const cls = `sl-tab${active ? " on" : ""}`;
  if (l.href.startsWith("#")) {
    return (
      <a href={l.href} className={cls} aria-current={active ? "location" : undefined}>
        {l.label}
      </a>
    );
  }
  return (
    <Link href={l.href} className={cls}>
      {l.label}
    </Link>
  );
}

/**
 * The frame both pages share, so they look and behave like one product: a floating pill of tabs that follows the scroll,
 * the two actions on the right, smooth inertial scrolling, scroll reveals, and the `js` flag that arms them.
 * Tabs are the in-page links; any external link (GitHub) is shown as the ghost button instead of a tab.
 */
export function SiteShell({ links, cta, children }: { links: NavLink[]; cta: NavLink; children: ReactNode }) {
  const [js, setJs] = useState(false);
  const [paused, setPaused] = useState(false);
  const tabs = links.filter((l) => !l.href.startsWith("http"));
  const [active, setActive] = useState(tabs[0]?.href ?? "");

  useEffect(() => {
    setJs(true);
    try {
      setPaused(window.localStorage.getItem(MOTION_KEY) === "1");
    } catch {
      /* the choice just isn't remembered */
    }
  }, []);

  // Other motion on the page (the intro scene) follows the same pause control.
  useEffect(() => {
    document.documentElement.dataset.motion = paused ? "paused" : "";
  }, [paused]);

  // Smooth, inertial scrolling. Off for reduced motion; in-page anchors glide too.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true, anchors: { offset: -96 } });
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

  // The tab for the section currently under the top of the screen is the lit one.
  useEffect(() => {
    const anchors = tabs.filter((t) => t.href.startsWith("#"));
    if (!anchors.length) return;
    const spy = () => {
      let cur = anchors[0].href;
      for (const t of anchors) {
        const el = document.getElementById(t.href.slice(1));
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.35) cur = t.href;
      }
      setActive(cur);
    };
    spy();
    window.addEventListener("scroll", spy, { passive: true });
    window.addEventListener("resize", spy);
    return () => {
      window.removeEventListener("scroll", spy);
      window.removeEventListener("resize", spy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map((t) => t.href).join("|")]);

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
      <div className="sl-progress" aria-hidden="true" />
      <nav className="sl-nav" aria-label="Main">
        <div className="sl-nav-in">
          <div className="sl-nav-left">
            <Link href="/" className="sl-brand" aria-label="Sluice, home">
              <LogoMark size={36} />
            </Link>
            <div className="sl-pill-nav">
              {tabs.map((l) => (
                <Tab key={l.href + l.label} l={l} active={active === l.href} />
              ))}
            </div>
          </div>
          <div className="sl-nav-right">
            <button type="button" className="sl-motion" onClick={togglePaused} aria-pressed={paused} aria-label={paused ? "Play motion" : "Pause motion"} title={paused ? "Play motion" : "Pause motion"}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                {paused ? <path d="M3 1.8v8.4L10 6z" fill="currentColor" /> : <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />}
              </svg>
            </button>
            <a className="sl-ghost" href={GITHUB} target="_blank" rel="noreferrer">
              <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0z"
                />
              </svg>
              GitHub
            </a>
            <Link href={cta.href} className="sl-solid">
              <span className="sl-solid-text">{cta.label}</span>
              <span className="sl-arrow" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
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
