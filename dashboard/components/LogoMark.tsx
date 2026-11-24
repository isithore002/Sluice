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

/**
 * The Sluice mark: a rounded tile holding an S-shaped channel (the "S"), with a brass drop at the outlet
 * (brass is this site's colour for "paid"). Greys only, so it sits on the black and grey theme.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b2b30" />
          <stop offset="1" stopColor="#0a0a0c" />
        </linearGradient>
        <linearGradient id={`e${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a4a4ad" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#t${id})`} />
      <rect x="1.5" y="1.5" width="61" height="61" rx="16.5" fill="none" stroke={`url(#e${id})`} />
      <path
        d="M46 19H28a7 7 0 0 0 0 14h8a7 7 0 0 1 0 14H22"
        fill="none"
        stroke={`url(#s${id})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="47" r="3.4" fill="#e7bd72" />
    </svg>
  );
}
