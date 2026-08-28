"use client";

/*
  The Gallery, four ways of standing in front of the same archive.

  WALL      the ambient mosaic, drifting — the room you walk past
  ICONS     the Finder icon grid — every piece its own object, named
  DETAILS   the Finder list — one row per file, the archive as a ledger
  CAROUSEL  one work at a time, full size, with a filmstrip to walk it

  One dataset feeds all four; the subnav only changes how it is stood in
  front of. The choice persists per browser, and ?view= overrides it for a
  given load so a link (or the sandbox) can open any view directly.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WallView from "./WallView";
import { useDragScroll } from "./useDragScroll";
import { IconCaret } from "./icons";

export type GalleryItem = {
  id: number;
  title: string;
  artist: string | null;
  w: number;
  h: number;
  hex: string;
  format: string | null;
  bytes: number | null;
  createdAt: number | null;
};

const VIEWS = [
  { key: "wall", label: "Wall" },
  { key: "icons", label: "Icons" },
  { key: "details", label: "Details" },
  { key: "carousel", label: "Carousel" },
] as const;
type ViewKey = typeof VIEWS[number]["key"];

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtBytes = (b: number | null) =>
  b == null ? "—" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB";

export default function GalleryView({ items }: { items: GalleryItem[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<ViewKey>("wall");
  const [cursor, setCursor] = useState(0);   // carousel position
  const stripDrag = useDragScroll();
  const stripRef = useRef<HTMLDivElement>(null);

  /* ?view= wins for this load; otherwise the last choice this browser made */
  useEffect(() => {
    const asked = params.get("view");
    if (asked && VIEWS.some((v) => v.key === asked)) { setView(asked as ViewKey); return; }
    try {
      const kept = localStorage.getItem("atlas-gallery-view");
      if (kept && VIEWS.some((v) => v.key === kept)) setView(kept as ViewKey);
    } catch { /* first visit */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (k: ViewKey) => {
    setView(k);
    try { localStorage.setItem("atlas-gallery-view", k); } catch { /* fine */ }
  };

  const current = items[cursor] ?? null;

  /* the carousel walks with the keyboard, as a viewer should */
  useEffect(() => {
    if (view !== "carousel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCursor((c) => Math.min(items.length - 1, c + 1));
      if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, items.length]);

  /* keep the active filmstrip cell in sight as the cursor walks */
  useEffect(() => {
    if (view !== "carousel") return;
    stripRef.current?.querySelector(".gal-strip__cell.is-on")
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [cursor, view]);

  const open = (id: number) => router.push("/analyze?id=" + id);

  const wallItems = useMemo(
    () => items.map((i) => ({ id: i.id, w: i.w, h: i.h, hex: i.hex, title: i.title })),
    [items],
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Gallery</h1>
          <span className="pill pill--static">{items.length} pieces</span>
        </div>
        <div className="topbar__spacer" />
        <span className="mono-xs">
          {view === "wall" ? "hover to pause / scroll to scrub / click to analyze"
            : view === "carousel" ? "arrow keys walk the archive / click opens in analyze"
            : "click opens in analyze"}
        </span>
      </header>

      {/* ---- the subnav: how to stand in front of the archive ---- */}
      <nav className="subnav" aria-label="Gallery view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={"subnav__item" + (view === v.key ? " is-on" : "")}
            aria-current={view === v.key ? "page" : undefined}
            onClick={() => pick(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="work">
        <main className="pane pane--flush" tabIndex={-1}>

          {view === "wall" && <WallView items={wallItems} />}

          {view === "icons" && (
            <div className="gal-icons" role="list">
              {items.map((it) => (
                <button key={it.id} className="gal-icon" role="listitem" onClick={() => open(it.id)} title={it.title}>
                  <span className="gal-icon__frame">
                    <img src={"/api/img/" + it.id + "?s=320"} alt={it.title} loading="lazy" decoding="async" />
                  </span>
                  <span className="gal-icon__name">{it.title}</span>
                </button>
              ))}
            </div>
          )}

          {view === "details" && (
            <div className="gal-list" role="table" aria-label="Archive as a list">
              <div className="gal-list__row gal-list__row--head" role="row">
                <span role="columnheader" aria-hidden="true" />
                <span role="columnheader">Title</span>
                <span role="columnheader">Artist</span>
                <span role="columnheader" className="num">Dimensions</span>
                <span role="columnheader">Kind</span>
                <span role="columnheader" className="num">Size</span>
                <span role="columnheader" className="num">Added</span>
              </div>
              {items.map((it) => (
                <button key={it.id} className="gal-list__row" role="row" onClick={() => open(it.id)}>
                  <span className="gal-list__thumb" role="cell">
                    <img src={"/api/img/" + it.id + "?s=128"} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="gal-list__title" role="cell">{it.title}</span>
                  <span className="gal-list__dim" role="cell">{it.artist ?? "—"}</span>
                  <span className="gal-list__dim num" role="cell">{it.w} × {it.h}</span>
                  <span className="gal-list__dim" role="cell">{(it.format ?? "image").toUpperCase()}</span>
                  <span className="gal-list__dim num" role="cell">{fmtBytes(it.bytes)}</span>
                  <span className="gal-list__dim num" role="cell">{fmtDate(it.createdAt)}</span>
                </button>
              ))}
            </div>
          )}

          {view === "carousel" && current && (
            <div className="gal-carousel">
              <div className="gal-stage">
                <button
                  className="gal-stage__nav" aria-label="Previous"
                  disabled={cursor === 0}
                  onClick={() => setCursor((c) => Math.max(0, c - 1))}
                ><IconCaret width={15} height={15} style={{ transform: "rotate(90deg)" }} /></button>
                <button className="gal-stage__frame" onClick={() => open(current.id)} title="Open in Analyze">
                  <img key={current.id} src={"/api/img/" + current.id} alt={current.title} decoding="async" />
                </button>
                <button
                  className="gal-stage__nav" aria-label="Next"
                  disabled={cursor === items.length - 1}
                  onClick={() => setCursor((c) => Math.min(items.length - 1, c + 1))}
                ><IconCaret width={15} height={15} style={{ transform: "rotate(-90deg)" }} /></button>
              </div>
              <div className="gal-meta">
                <span className="gal-meta__title">{current.title}</span>
                <span className="gal-meta__rest">
                  {current.artist ? current.artist + " · " : ""}{current.w} × {current.h} ·{" "}
                  {(current.format ?? "image").toUpperCase()} · {fmtBytes(current.bytes)} · {fmtDate(current.createdAt)} ·{" "}
                  {cursor + 1} / {items.length}
                </span>
              </div>
              <div className="gal-strip" ref={stripRef} {...stripDrag}>
                {items.map((it, i) => (
                  <button
                    key={it.id}
                    className={"gal-strip__cell" + (i === cursor ? " is-on" : "")}
                    onClick={() => setCursor(i)}
                    title={it.title}
                    aria-current={i === cursor}
                  >
                    <img src={"/api/img/" + it.id + "?s=128"} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  );
}
