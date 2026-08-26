"use client";

/*
  Noise-to-glyph micro-loader (ported from loaders-order.js): a 5x5 grid of
  cells whose opacity is a PURE function of (cellIndex, timeStep), so the same
  frame always renders the same. Time quantised to ~95ms steps reads as dither
  rather than shimmer; resolving is one lerp per cell from its noise value to
  its glyph target. Here it breathes: static resolves into the mark, then
  dissolves back, for as long as the answer is being worked on.
*/

import { useEffect, useRef } from "react";

const GLYPH = [
  [0, 0, 1, 0, 0],
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0],
];

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

const CELL = 17;
const PAD = (100 - CELL * 5) / 2;
const CYCLE = 2300;  // ms: noise -> glyph -> noise
const STEP = 95;     // ms per dither step

export default function GlyphLoader({ size = 16, className }: { size?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const rects = Array.from(svg.querySelectorAll("rect"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // no motion: hold the resolved mark
      rects.forEach((r, i) => {
        const on = GLYPH[Math.floor(i / 5)][i % 5] === 1;
        r.setAttribute("fill-opacity", on ? "1" : "0.05");
      });
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = now - t0;
      // triangle wave over the cycle -> resolve in, hold, dissolve out
      const ph = (t % CYCLE) / CYCLE;
      const tri = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
      const rp = easeInOut(Math.min(1, Math.max(0, (tri - 0.12) / 0.72)));
      const step = Math.floor(t / STEP);
      rects.forEach((r, index) => {
        const on = GLYPH[Math.floor(index / 5)][index % 5] === 1;
        const noise = 0.06 + hash(index, step) * 0.86;
        const target = on ? 1 : 0.05;
        r.setAttribute("fill-opacity", (noise + (target - noise) * rp).toFixed(3));
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ color: "var(--accent)", flex: "none" }}
      aria-hidden
    >
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
