"use client";

import { Fragment, useEffect, useRef } from "react";

export type Part = { t: string; hl?: boolean };

/**
 * A statement whose words light up one by one as it scrolls through the screen: dim at first, white once read, with the
 * highlighted words in brass. Without scripting (or with reduced motion) every word is simply lit, so it is always readable.
 */
export function ScrollWords({ parts, className }: { parts: Part[]; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const words = parts.flatMap((p) => p.t.split(/\s+/).filter(Boolean).map((w) => ({ w, hl: !!p.hl })));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const spans = Array.from(el.querySelectorAll<HTMLElement>(".w"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spans.forEach((s) => s.classList.add("lit"));
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.4)));
      const n = Math.round(p * spans.length);
      spans.forEach((s, i) => s.classList.toggle("lit", i < n));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <h2 ref={ref} className={className}>
      {words.map((x, i) => (
        <Fragment key={i}>
          <span className={`w${x.hl ? " hl" : ""}`}>{x.w}</span>{" "}
        </Fragment>
      ))}
    </h2>
  );
}
