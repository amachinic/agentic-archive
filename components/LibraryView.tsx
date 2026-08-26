"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImageRow } from "@/lib/queries";
import Inspector from "./Inspector";
import Select from "./Select";
import { IconSearch, IconX } from "./icons";

type Filter = { c: string; tag: string; q: string; sort: string };
type Coll = { id: number; name: string; depth: number };

export default function LibraryView({
  initialRows, total, filter, collections,
}: {
  initialRows: ImageRow[]; total: number; filter: Filter; collections: Coll[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ImageRow[]>(initialRows);
  const [selected, setSelected] = useState<number | null>(null);
  // Breadcrumb of inspector hops: following a similar image pushes the one you
  // came from, so Back retraces the chain image by image.
  const [trail, setTrail] = useState<number[]>([]);
  const [compareSet, setCompareSet] = useState<number[]>([]);
  const [q, setQ] = useState(filter.q);
  const [loadingMore, setLoadingMore] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Server sends a fresh page on navigation; drop stale client state with it.
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  const nav = useCallback((patch: Partial<Filter>) => {
    const next = { ...filter, ...patch };
    const p = new URLSearchParams();
    if (next.c) p.set("c", next.c);
    if (next.tag) p.set("tag", next.tag);
    if (next.q) p.set("q", next.q);
    if (next.sort && next.sort !== "newest") p.set("sort", next.sort);
    router.push("/library?" + p.toString());
  }, [filter, router]);

  // Debounced search
  useEffect(() => {
    if (q === filter.q) return;
    const t = setTimeout(() => nav({ q }), 350);
    return () => clearTimeout(t);
  }, [q, filter.q, nav]);

  async function loadMore() {
    if (loadingRef.current) return; // observer can fire in bursts
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({ offset: String(rows.length), limit: "120" });
      if (filter.c) p.set("c", filter.c);
      if (filter.tag) p.set("tag", filter.tag);
      if (filter.q) p.set("q", filter.q);
      if (filter.sort) p.set("sort", filter.sort);
      const res = await fetch("/api/list?" + p.toString());
      const data = await res.json();
      setRows((r) => [...r, ...data.rows]);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }

  // Infinite scroll: the spinner row at the foot of the grid is a sentinel;
  // when it drifts within ~700px of the viewport the next page fetches itself.
  // Recreated per page so each newly grown grid gets a fresh intersection.
  useEffect(() => {
    const pane = paneRef.current, sentinel = moreRef.current;
    if (!pane || !sentinel || rows.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
      { root: pane, rootMargin: "700px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, total, filter.c, filter.tag, filter.q, filter.sort]);

  function toggleCompare(id: number) {
    setCompareSet((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  }

  function patchRow(id: number, patch: Partial<ImageRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const title =
    filter.tag ? "#" + filter.tag
    : filter.c ? (collections.find((c) => String(c.id) === filter.c)?.name ?? "Folder")
    : "Library";

  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">{title}</h1>
          <span className="pill pill--static">{total} image{total === 1 ? "" : "s"}</span>
        </div>
        <div className="topbar__spacer" />
        <div className="field" style={{ width: 290 }}>
          <IconSearch width={13} height={13} />
          <input
            placeholder="Search title, prompt, notes..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search library"
          />
          {q && <button className="btn is-ghost btn--icon" style={{ height: 18, width: 18, border: 0 }} onClick={() => setQ("")} aria-label="Clear search"><IconX width={11} height={11} /></button>}
        </div>
        <Select
          value={filter.sort}
          onChange={(v) => nav({ sort: v })}
          ariaLabel="Sort order"
          align="right"
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "luma", label: "Dark to light" },
            { value: "chroma", label: "Most colorful" },
          ]}
        />
      </header>

      <div className="work">
        <main className="pane" tabIndex={-1} ref={paneRef}>
          {rows.length === 0 ? (
            <div className="empty">
              <h2>Nothing here yet</h2>
              <p>Run the ingest to fill the library: npm run ingest, then refresh.</p>
            </div>
          ) : (
            <div className="grid-wrap">
              <div className="masonry">
                {rows.map((img) => (
                  <Cell
                    key={img.id}
                    img={img}
                    selected={selected === img.id}
                    inCompare={compareSet.includes(img.id)}
                    onOpen={() => { setSelected(img.id); setTrail([]); }}
                    onToggleCompare={() => toggleCompare(img.id)}
                  />
                ))}
              </div>
              {rows.length < total ? (
                <div className="load-more" ref={moreRef} aria-live="polite">
                  <span className="spin" style={{ width: 20, height: 20 }} />
                  <span className="mono-xs">
                    {loadingMore ? "loading" : "scroll for more"} · {total - rows.length} remaining
                  </span>
                </div>
              ) : total > 120 ? (
                <div className="load-more">
                  <span className="mono-xs">end of the set · {total} images</span>
                </div>
              ) : null}
            </div>
          )}
        </main>

        {selected !== null && (
          <div className="inspector-shell">
          <Inspector
            key={selected}
            imageId={selected}
            collections={collections}
            onClose={() => { setSelected(null); setTrail([]); }}
            onNavigate={(id) => {
              setTrail((t) => (selected !== null ? [...t, selected] : t));
              setSelected(id);
            }}
            onBack={trail.length ? () => {
              const t = [...trail];
              const prev = t.pop()!;
              setTrail(t);
              setSelected(prev);
            } : null}
            onRowPatch={patchRow}
            onRemoved={() => setRows((rs) => rs.filter((r) => r.id !== selected))}
          />
          </div>
        )}
      </div>

      {compareSet.length === 2 && (
        <div className="compare-bar">
          {compareSet.map((id) => <img key={id} src={"/api/img/" + id} alt="" />)}
          <span style={{ fontSize: "var(--font-body-sm)", color: "var(--text-secondary)" }}>
            2 images staged
          </span>
          <div className="topbar__spacer" />
          <button
            className="btn is-primary"
            onClick={() => router.push("/diptych?a=" + compareSet[0] + "&b=" + compareSet[1])}
          >Open diptych</button>
          <button className="btn is-ghost" onClick={() => setCompareSet([])}>Clear</button>
        </div>
      )}
    </>
  );
}

function Cell({
  img, selected, inCompare, onOpen, onToggleCompare,
}: {
  img: ImageRow; selected: boolean; inCompare: boolean; onOpen: () => void; onToggleCompare: () => void;
}) {
  const ratio = img.width && img.height ? img.width / img.height : 1;
  return (
    <div
      className={
        "cell" + (selected || inCompare ? " is-selected" : "")
      }
      onClick={(e) => (e.shiftKey ? onToggleCompare() : onOpen())}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      title={(img.ai_title || img.filename) + "  (shift-click to stage for compare)"}
    >
      <img
        src={"/api/img/" + img.id}
        alt={img.ai_title || img.filename}
        loading="lazy"
        style={{ aspectRatio: String(ratio) }}
      />
      <div className="cell__meta">
        <span className="cell__name">{img.ai_title || img.filename}</span>
        {img.palette.length > 0 && (
          <span className="swatch-row">
            {img.palette.slice(0, 5).map((s, i) => (
              <i key={i} style={{ background: s.hex, width: Math.max(8, s.pct * 100) + "%" }} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
