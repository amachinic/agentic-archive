"use client";

/*
  The archetype idents, in the house micro-animation language: a 5x5 dither
  field with one verb per archetype. The Curator draws its checkerboard in
  reading order, clears it, then resolves into a plus sign before looping.
  Its ordered fades run continuously; the noisier scan/drop modes stay
  quantised so they read as dither rather than shimmer.
*/

import { useEffect, useRef } from "react";

export type PixMode = "forms" | "scan" | "drop" | "seek";

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const cellOf = (i: number) => ({ r: Math.floor(i / 5), c: i % 5 });

const makeForm = (test: (r: number, c: number) => boolean) =>
  Array.from({ length: 25 }, (_, i) => test(Math.floor(i / 5), i % 5));

const PLUS_FORM = makeForm((r, c) => r === 2 || c === 2);
const CHECKER_FORM = makeForm((r, c) => (r + c) % 2 === 0);
const CHECKER_ORDER = CHECKER_FORM.flatMap((on, i) => (on ? [i] : []));
const CHECKER_RANK = Array.from({ length: 25 }, (_, i) => CHECKER_ORDER.indexOf(i));

const OFF = 0.04;
const ON = 0.95;
const POINT_STAGGER = 85;
const POINT_FADE = 150;
const BOARD_REVEAL = (CHECKER_ORDER.length - 1) * POINT_STAGGER + POINT_FADE;
const BOARD_HOLD = 380;
const BOARD_CLEAR = 300;
const PLUS_REVEAL = 300;
const PLUS_HOLD = 700;
const PLUS_CLEAR = 300;
const FORM_CYCLE = BOARD_REVEAL + BOARD_HOLD + BOARD_CLEAR + PLUS_REVEAL + PLUS_HOLD + PLUS_CLEAR;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

/* opacity for cell i at time t, per mode — exported so ToolCheck can run a
   lens's verb while its tool works, then resolve it into the pixel check */
export function opacityAt(mode: PixMode, i: number, t: number, step: number): number {
  const { r, c } = cellOf(i);

  if (mode === "forms") {
    const phase = t % FORM_CYCLE;
    const boardHoldAt = BOARD_REVEAL;
    const boardClearAt = boardHoldAt + BOARD_HOLD;
    const plusRevealAt = boardClearAt + BOARD_CLEAR;
    const plusHoldAt = plusRevealAt + PLUS_REVEAL;
    const plusClearAt = plusHoldAt + PLUS_HOLD;

    if (phase < boardHoldAt) {
      const rank = CHECKER_RANK[i];
      return rank < 0 ? OFF : mix(OFF, ON, smoothstep((phase - rank * POINT_STAGGER) / POINT_FADE));
    }
    if (phase < boardClearAt) return CHECKER_FORM[i] ? ON : OFF;
    if (phase < plusRevealAt) {
      const progress = smoothstep((phase - boardClearAt) / BOARD_CLEAR);
      return CHECKER_FORM[i] ? mix(ON, OFF, progress) : OFF;
    }
    if (phase < plusHoldAt) {
      const progress = smoothstep((phase - plusRevealAt) / PLUS_REVEAL);
      return PLUS_FORM[i] ? mix(OFF, ON, progress) : OFF;
    }
    if (phase < plusClearAt) return PLUS_FORM[i] ? ON : OFF;
    const progress = smoothstep((phase - plusClearAt) / PLUS_CLEAR);
    return PLUS_FORM[i] ? mix(ON, OFF, progress) : OFF;
  }

  if (mode === "scan") {
    /* Archivist: a scan line sweeps down, rows resolve behind it */
    const sweep = ((t % 1900) / 1900) * 7 - 1;
    const behind = r < sweep;
    const isLine = Math.abs(r - sweep) < 0.6;
    return isLine ? 1 : behind ? 0.75 : 0.05 + hash(i, step) * 0.5;
  }

  if (mode === "seek") {
    /* Historian: a ring leaves home and goes out, again and again — the
       hunt departs, the centre stays lit, what it passed keeps a low glow */
    const d = Math.abs(r - 2) + Math.abs(c - 2);       // Manhattan ring 0..4
    const ring = ((t % 1900) / 1900) * 6 - 0.5;
    if (d === 0) return 0.9;
    if (Math.abs(d - ring) < 0.55) return 1;
    return d < ring ? 0.3 : 0.05 + hash(i, step) * 0.25;
  }

  /* Media Manager: a payload drops into a tray, again and again */
  const ph = (t % 1600) / 1600;
  const y = ph * 5.4 - 0.7;
  const tray = r === 4 || (r === 3 && (c === 0 || c === 4));
  if (tray) return 0.8;
  return c === 2 && Math.abs(r - y) < 0.6 && r < 4 ? 1 : 0.04 + hash(i, step) * 0.15;
}

/* the mode's most characteristic frame, for reduced motion and for anything
   that needs the ident at rest */
export function stillAt(mode: PixMode, i: number): boolean {
  const { r, c } = cellOf(i);
  if (mode === "forms") return PLUS_FORM[i];
  if (mode === "scan") return r === 2;
  /* the Historian's still: centre plus its middle ring, mid-departure */
  if (mode === "seek") return Math.abs(r - 2) + Math.abs(c - 2) === 2 || (r === 2 && c === 2);
  return r === 4 || (r === 3 && (c === 0 || c === 4)) || (c === 2 && r === 1);
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
      rects.forEach((r, i) => r.setAttribute("fill-opacity", stillAt(mode, i) ? "0.95" : "0.06"));
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const elapsed = now - t0;
      const t = mode === "forms" ? elapsed : Math.floor(elapsed / 95) * 95;
      const step = Math.floor(elapsed / 95);
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
