"use client";

/*
  The agent's checkmark, in the house micro-animation language: a 5x5 dither
  field (same mechanics as the glyph loader) that boils while the tool runs,
  then resolves into a pixelated check and freezes. Deterministic noise,
  ~95ms quantised steps — dither, not shimmer.
*/

import { useEffect, useRef } from "react";

const CHECK = [
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1],
  [0, 0, 0, 1, 0],
  [1, 0, 1, 0, 0],
  [0, 1, 0, 0, 0],
];

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const CELL = 17;
const PAD = (100 - CELL * 5) / 2;

export default function ToolCheck({ running, size = 14 }: { running: boolean; size?: number }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const rects = Array.from(svg.querySelectorAll("rect"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      rects.forEach((r, i) => {
        const on = CHECK[Math.floor(i / 5)][i % 5] === 1;
        r.setAttribute("fill-opacity", on ? "1" : "0.04");
      });
      return;
    }

    let raf = 0;
    let resolveT: number | null = null;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const step = Math.floor(now / 95);
      let rp = 0;
      if (!running) {
        if (resolveT === null) resolveT = now;
        rp = Math.min(1, (now - resolveT) / 380);
      }
      rects.forEach((r, i) => {
        const on = CHECK[Math.floor(i / 5)][i % 5] === 1;
        const noise = 0.08 + hash(i, step) * 0.8;
        const target = on ? 1 : 0.04;
        r.setAttribute("fill-opacity", (noise + (target - noise) * rp).toFixed(3));
      });
      if (!running && rp >= 1) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return (
    <svg ref={ref} viewBox="0 0 100 100" width={size} height={size} style={{ color: "var(--accent)", flex: "none" }} aria-hidden>
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
