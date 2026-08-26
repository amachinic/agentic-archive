"use client";

/*
  The Wall: a full-bleed mosaic of columns drifting vertically at slightly
  different speeds, the archive as ambient signage. Hovering slows the room;
  scroll input scrubs it; clicking opens the piece in the library.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: number; w: number; h: number; hex: string; title: string };

const COL_W = 236;
const GAP = 12;

export default function WallView({ items }: { items: Item[] }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [colCount, setColCount] = useState(0);
  const [colW, setColW] = useState(COL_W);
  const [paused, setPaused] = useState(false);
  const speedRef = useRef(1);
  const scrubRef = useRef(0);
  /* touch/pointer drag scrubs the wall; a real drag must not fire the
     click-through to Analyze on release */
  const dragY = useRef<number | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const w = el.clientWidth;
      const n = Math.max(2, Math.floor((w + GAP) / (COL_W + GAP)));
      setColCount(n);
      // narrow screens: two columns always fit, columns shrink to match
      setColW(n * (COL_W + GAP) + GAP > w ? Math.floor((w - GAP * (n + 1)) / n) : COL_W);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Deterministic shuffle per mount, seeded from the item list length + first id.
  const shuffled = useMemo(() => {
    const arr = [...items];
    let seed = (items.length * 2654435761 + (items[0]?.id ?? 1) * 97) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [items]);

  // Distribute into columns, shortest-first so columns stay balanced.
  const columns = useMemo(() => {
    if (!colCount) return [];
    const cols: { items: Item[]; height: number }[] = Array.from({ length: colCount }, () => ({ items: [], height: 0 }));
    for (const it of shuffled) {
      const target = cols.reduce((a, b) => (a.height <= b.height ? a : b));
      target.items.push(it);
      target.height += (colW * it.h) / Math.max(1, it.w) + GAP;
    }
    return cols;
  }, [shuffled, colCount, colW]);

  // Animation: each column loops its own content; odd columns drift up, even drift down.
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const offsets = columns.map(() => 0);
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const target = paused ? 0 : 1;
      speedRef.current += (target - speedRef.current) * 0.06;
      const scrub = scrubRef.current;
      scrubRef.current *= 0.92;
      columns.forEach((col, i) => {
        const el = colRefs.current[i];
        if (!el) return;
        const h = el.scrollHeight / 2; // content is doubled for the loop
        if (h <= 0) return;
        const dir = i % 2 === 0 ? 1 : -1;
        const base = (12 + (i % 3) * 4.5) / 1000; // px per ms, per-column variance
        offsets[i] += dir * base * dt * speedRef.current + dir * scrub * 0.4;
        // wrap into [0, h)
        offsets[i] = ((offsets[i] % h) + h) % h;
        el.style.transform = "translateY(" + (-offsets[i]) + "px)";
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [columns, paused]);

  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Gallery</h1>
          <span className="pill pill--static">{items.length} pieces</span>
        </div>
        <div className="topbar__spacer" />
        <span className="mono-xs">hover to pause · scroll to scrub · click to analyze</span>
      </header>
      <div className="work">
        <main className="pane pane--flush" tabIndex={-1}>
          <div
            className="wall"
            ref={wrapRef}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onWheel={(e) => { scrubRef.current += e.deltaY * 0.06; }}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") return; // mouse keeps hover+wheel
              dragY.current = e.clientY;
              dragMoved.current = false;
              setPaused(true);
            }}
            onPointerMove={(e) => {
              if (dragY.current === null) return;
              const dy = dragY.current - e.clientY;
              if (Math.abs(dy) > 4) dragMoved.current = true;
              scrubRef.current += dy * 0.9;
              dragY.current = e.clientY;
            }}
            onPointerUp={() => { dragY.current = null; setPaused(false); }}
            onPointerCancel={() => { dragY.current = null; setPaused(false); }}
          >
            {columns.map((col, i) => (
              <div
                key={i}
                className="wall__col"
                style={{ left: i * (colW + GAP) + GAP / 2, width: colW }}
                ref={(el) => { colRefs.current[i] = el; }}
              >
                {/* content twice for a seamless loop */}
                {[0, 1].map((rep) =>
                  col.items.map((it) => (
                    <button
                      key={rep + ":" + it.id}
                      className="wall__item"
                      style={{
                        border: 0, padding: 0, cursor: "pointer",
                        aspectRatio: it.w + " / " + it.h,
                        background: it.hex,
                      }}
                      onClick={() => { if (!dragMoved.current) router.push("/analyze?id=" + it.id); }}
                      title={it.title}
                      tabIndex={rep === 0 ? 0 : -1}
                      aria-hidden={rep === 1}
                    >
                      <img src={"/api/img/" + it.id} alt={rep === 0 ? it.title : ""} loading="lazy" />
                    </button>
                  ))
                )}
              </div>
            ))}
            <div className="wall__veil" />
          </div>
        </main>
      </div>
    </>
  );
}
