"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AsciiField } from "./AsciiField";
import { LogoMark } from "./LogoMark";

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

/**
 * The frame both pages share, so they look and behave like one product: glyph-field background, sticky nav,
 * footer, the pointer spotlight on cards, and the `js` flag that arms scroll-reveal animations.
 */
export function SiteShell({ badge, links, cta, children }: { badge?: string; links: NavLink[]; cta: NavLink; children: ReactNode }) {
  const [js, setJs] = useState(false);
  useEffect(() => setJs(true), []);

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
      <AsciiField className="sl-ascii" />

      <nav className="sl-nav" aria-label="Main">
        <div className="sl-nav-in">
          <Link href="/" className="sl-brand">
            <LogoMark size={26} />
            Sluice
            {badge && <small>{badge}</small>}
          </Link>
          <div className="sl-links">
            {links.map((l) => (
              <NavItem key={l.href + l.label} l={l} />
            ))}
            <Link href={cta.href} className="sl-pill">
              {cta.label}
            </Link>
          </div>
        </div>
      </nav>

      {children}

      <footer className="sl-foot-bar sl-wrap">
        <p>Built for the Reactive Omni Buildathon · Every Second Counts track · testnet demo, staged by us</p>
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
