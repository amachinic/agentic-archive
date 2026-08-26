"use client";

/*
  The archetype idents, in the house micro-animation language: a 5x5 dither
  field, deterministic noise, ~95ms quantised steps. One verb per archetype —
  and the Curator's verb is FORM: a plus sign, a filled diamond, a checker-
  board, each held crisp, each hand-off a per-pixel dither migration. Shapes,
  not shimmer.
*/

import { useEffect, useRef } from "react";

export type PixMode = "forms" | "scan" | "drop" | "atlas";

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const cellOf = (i: number) => ({ r: Math.floor(i / 5), c: i % 5 });

/* Atlas's initial, 5x5: a classic pointed A. The centre row is both the
   crossbar and the line the legs splay from, so the dot the letter grows
   from is already part of the letter. */
const A_FORM: boolean[] = [
  0, 0, 1, 0, 0,
  0, 1, 0, 1, 0,
  1, 1, 1, 1, 1,
  1, 0, 0, 0, 1,
  1, 0, 0, 0, 1,
].map(Boolean);

/* the Curator's three forms: plus -> filled diamond -> checkerboard */
const FORMS: boolean[][] = (() => {
  const mk = (f: (r: number, c: number) => boolean) =>
    Array.from({ length: 25 }, (_, i) => f(Math.floor(i / 5), i % 5));
  return [
    mk((r, c) => r === 2 || c === 2),                     // plus
    mk((r, c) => Math.abs(r - 2) + Math.abs(c - 2) <= 2), // filled diamond
    mk((r, c) => (r + c) % 2 === 0),                      // checkerboard
  ];
})();

/* opacity for cell i at time t, per mode */
function opacityAt(mode: PixMode, i: number, t: number, step: number): number {
  const { r, c } = cellOf(i);
  const noise = 0.05 + hash(i, step) * 0.14;

  if (mode === "forms") {
    /* hold each form crisp, then migrate pixel-by-pixel into the next */
    const T = 1600, u = (t % T) / T, k = Math.floor(t / T) % 3;
    const cur = FORMS[k][i], nxt = FORMS[(k + 1) % 3][i];
    let on = cur;
    if (u >= 0.62 && cur !== nxt) {
      const m = (u - 0.62) / 0.38;
      on = m > hash(i, k * 31 + 7) ? nxt : cur;
    }
    return on ? 0.95 : noise;
  }

  if (mode === "scan") {
    /* Archivist: a scan line sweeps down, rows resolve behind it */
    const sweep = ((t % 1900) / 1900) * 7 - 1;
    const behind = r < sweep;
    const isLine = Math.abs(r - sweep) < 0.6;
    return isLine ? 1 : behind ? 0.75 : 0.05 + hash(i, step) * 0.5;
  }

  if (mode === "drop") {
    /* Media Manager: a payload drops into a tray, again and again */
    const ph = (t % 1600) / 1600;
    const y = ph * 5.4 - 0.7;
    const tray = r === 4 || (r === 3 && (c === 0 || c === 4));
    if (tray) return 0.8;
    return c === 2 && Math.abs(r - y) < 0.6 && r < 4 ? 1 : 0.04 + hash(i, step) * 0.15;
  }

  /* Atlas: a dot in the centre grows pixel by pixel into an "A", holds,
     then collapses back to the dot */
  const T = 2400, u = (t % T) / T;
  const isA = A_FORM[i];
  const isDot = r === 2 && c === 2;
  let on: boolean;
  if (u < 0.18) on = isDot;                                   // the dot alone
  else if (u < 0.46) on = isDot || (isA && (u - 0.18) / 0.28 > hash(i, 3));  // births
  else if (u < 0.80) on = isA;                                // the letter, crisp
  else on = isDot || (isA && (u - 0.80) / 0.20 < hash(i, 11)); // deaths
  /* the counters stay quieter than elsewhere: at 30px a noisy hole eats
     the letterform */
  return on ? 0.95 : 0.03 + hash(i, step) * 0.06;
}

const CELL = 17;
const PAD = (100 - CELL * 5) / 2;

export default function ArchetypePix({ mode, size = 30 }: { mode: PixMode; size?: number }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const rects = Array.from(svg.querySelectorAll("rect"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      /* static: the mode's most characteristic frame */
      const still = mode === "forms" ? FORMS[1] : mode === "atlas" ? A_FORM :
        Array.from({ length: 25 }, (_, i) => {
          const { r, c } = cellOf(i);
          if (mode === "scan") return r === 2;
          return r === 4 || (r === 3 && (c === 0 || c === 4)) || (c === 2 && r === 1);
        });
      rects.forEach((r, i) => r.setAttribute("fill-opacity", still[i] ? "0.95" : "0.06"));
      return;
    }

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = Math.floor(now / 95) * 95; // quantised: dither, not shimmer
      const step = Math.floor(now / 95);
      rects.forEach((r, i) => r.setAttribute("fill-opacity", opacityAt(mode, i, t, step).toFixed(3)));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <svg ref={ref} viewBox="0 0 100 100" width={size} height={size} style={{ color: "currentColor", flex: "none" }} aria-hidden>
      {Array.from({ length: 25 }, (_, i) => {
        const r = Math.floor(i / 5), c = i % 5;
        return (
          <rect
            key={i}
            x={PAD + c * CELL + 1.4}
            y={PAD + r * CELL + 1.4}
            width={CELL - 2.8}
            height={CELL - 2.8}
            rx={2.6}
            fill="currentColor"
            fillOpacity={0.06}
          />
        );
      })}
    </svg>
  );
}
