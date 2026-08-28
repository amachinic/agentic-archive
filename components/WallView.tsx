"use client";

/*
  The Wall: a full-bleed mosaic of columns drifting vertically at slightly
  different speeds, the archive as ambient signage. Hovering slows the room;
  scroll input scrubs it; clicking opens the piece in the library.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: number; w: number; h: number; hex: string; title: string };

const INITIAL_COL_W = 236;
const GAP = 12;
const MOBILE_COLUMNS = 2;
const DESKTOP_COLUMNS = 5;
const MOBILE_QUERY = "(max-width: 720px)";

export default function WallView({ items }: { items: Item[] }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [colCount, setColCount] = useState(0);
  const [colW, setColW] = useState(INITIAL_COL_W);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const scrubRef = useRef(0);
  const offsetsRef = useRef<number[]>([]);
  const loopHeightsRef = useRef<number[]>([]);
  /* touch/pointer drag scrubs the wall; a real drag must not fire the
     click-through to Analyze on release */
  const dragY = useRef<number | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    const el = wrapRef.current!;
    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const measure = () => {
      const w = el.clientWidth;
      const n = mobileQuery.matches ? MOBILE_COLUMNS : DESKTOP_COLUMNS;
      setColCount(n);
      setColW(Math.max(1, (w - GAP * n) / n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    mobileQuery.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      mobileQuery.removeEventListener("change", measure);
    };
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

  // Distribute into columns, shortest-first so columns stay balanced. Use a
  // width-independent estimate so sidebar and viewport resizing cannot move
  // pieces between columns while their geometry is changing.
  const columns = useMemo(() => {
    if (!colCount) return [];
    const cols: { items: Item[]; height: number }[] = Array.from({ length: colCount }, () => ({ items: [], height: 0 }));
    for (const it of shuffled) {
      const target = cols.reduce((a, b) => (a.height <= b.height ? a : b));
      target.items.push(it);
      target.height += it.h / Math.max(1, it.w) + GAP / INITIAL_COL_W;
    }
    return cols;
  }, [shuffled, colCount]);

  // Animation: each column loops its own content; odd columns drift up, even drift down.
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const offsets = offsetsRef.current;
    offsets.length = columns.length;
    for (let i = 0; i < columns.length; i++) {
      if (!Number.isFinite(offsets[i])) offsets[i] = 0;
    }

    // The first item in the repeated set marks the exact loop distance. Cache
    // it per layout so the animation does not force layout reads every frame.
    const loopHeights = columns.map((col, i) => {
      const repeatedStart = colRefs.current[i]?.children.item(col.items.length);
      if (repeatedStart instanceof HTMLElement) return repeatedStart.offsetTop;
      return col.items.reduce(
        (height, item) => height + (colW * item.h) / Math.max(1, item.w) + GAP,
        0,
      );
    });
    loopHeights.forEach((height, i) => {
      const previousHeight = loopHeightsRef.current[i];
      if (previousHeight > 0 && height > 0) {
        offsets[i] = (offsets[i] / previousHeight) * height;
      }
    });
    loopHeightsRef.current = loopHeights;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const target = pausedRef.current ? 0 : 1;
      speedRef.current += (target - speedRef.current) * 0.06;
      const scrub = scrubRef.current;
      scrubRef.current *= 0.92;
      columns.forEach((_, i) => {
        const el = colRefs.current[i];
        if (!el) return;
        const h = loopHeights[i];
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
  }, [columns, colW]);

  /* Chrome-free on purpose: the Gallery owns the topbar and the view subnav
     now, and the wall is one view among four rather than the whole page. */
  return (
          <div
            className="wall"
            ref={wrapRef}
            onMouseEnter={() => { pausedRef.current = true; }}
            onMouseLeave={() => { pausedRef.current = false; }}
            onWheel={(e) => { scrubRef.current += e.deltaY * 0.06; }}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") return; // mouse keeps hover+wheel
              dragY.current = e.clientY;
              dragMoved.current = false;
              pausedRef.current = true;
            }}
            onPointerMove={(e) => {
              if (dragY.current === null) return;
              const dy = dragY.current - e.clientY;
              if (Math.abs(dy) > 4) dragMoved.current = true;
              scrubRef.current += dy * 0.9;
              dragY.current = e.clientY;
            }}
            onPointerUp={() => { dragY.current = null; pausedRef.current = false; }}
            onPointerCancel={() => { dragY.current = null; pausedRef.current = false; }}
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
                      <img
                        src={"/api/img/" + it.id}
                        alt={rep === 0 ? it.title : ""}
                        width={it.w}
                        height={it.h}
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                  ))
                )}
              </div>
            ))}
            <div className="wall__veil" />
          </div>
  );
}
