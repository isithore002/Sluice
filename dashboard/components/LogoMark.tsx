"use client";

import { useId } from "react";

/** Lightning-bolt outline in unit space (y up). Shared by the 3D mesh and the flat SVG mark. */
export const BOLT: [number, number][] = [
  [0.1, 0.64],
  [-0.34, -0.04],
  [-0.04, -0.04],
  [-0.12, -0.64],
  [0.34, 0.08],
  [0.04, 0.08],
];
export const BOLT_SCALE = 0.82;

/** Flat version of the mark (ring + bolt). Used in the nav and as the fallback when WebGL is unavailable. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const d =
    BOLT.map(([x, y], i) => `${i ? "L" : "M"}${(100 + x * BOLT_SCALE * 100).toFixed(1)} ${(100 - y * BOLT_SCALE * 100).toFixed(1)}`).join(" ") +
    "Z";
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35d0ff" />
          <stop offset="0.45" stopColor="#3d8bff" />
          <stop offset="1" stopColor="#9a5bff" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="88" fill="none" stroke={`url(#g${id})`} strokeWidth="14" />
      <circle cx="100" cy="100" r="80" fill="#06070d" />
      <path d={d} fill="#fff" strokeLinejoin="round" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}
