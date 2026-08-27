"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImageRow } from "@/lib/queries";
import type { Analysis } from "@/lib/vision";
import { IconX, IconSparkle, IconArrowLeft } from "./icons";
import AnalysisBrief from "./AnalysisBrief";
import { useDialogs } from "./DialogProvider";
import { write } from "@/lib/write";
import Select from "./Select";

type Detail = ImageRow & {
  source_path: string | null;
  sha256: string;
  gen_meta: string | null;
  ai_analysis: Analysis | null;
  ai_model: string | null;
  ai_at: number | null;
  tags: { id: number; name: string; kind: string; source: string }[];
  collections: { id: number; name: string }[];
  similar: { other_id: number; score: number; image: ImageRow }[];
  links: { id: number; from_id: number; to_id: number; kind: string; note: string | null; filename: string; ai_title: string | null }[];
};

type Coll = { id: number; name: string; depth: number };

export default function Inspector({
  imageId, collections, onClose, onNavigate, onRowPatch, onBack, onRemoved,
}: {
  imageId: number;
  collections: Coll[];
  onClose: () => void;
  onNavigate: (id: number) => void;
  onRowPatch: (id: number, patch: Partial<ImageRow>) => void;
  /** Present after hopping through a similar image; retraces one step. */
  onBack?: (() => void) | null;
  /** Called after a successful removal, so the host view drops the image. */
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [img, setImg] = useState<Detail | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/images/" + imageId)
      .then((r) => r.json())
      .then((d) => { if (alive) setImg(d); })
      .catch(() => { if (alive) setError("Failed to load image"); });
    return () => { alive = false; };
  }, [imageId]);

  // Selecting an image IS the request for its analysis: first open of an
  // un-analyzed image kicks the vision pass off automatically. The ref guards
  // against re-triggering on the refetches that patch() performs.
  useEffect(() => {
    if (img && !img.ai_at && !analyzing && !autoRan.current) {
      autoRan.current = true;
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  // The reasoning model takes 20-90s; a counting clock is what makes the wait
  // read as work instead of a dead button.
  useEffect(() => {
    if (!analyzing) { setElapsed(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [analyzing]);

  async function patch(body: Record<string, unknown>) {
    const r = await write<Detail>("/api/images/" + imageId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      await dialogs.alert({ title: "Change not saved", message: r.message });
      return;
    }
    const d = r.data;
    setImg(d);
    onRowPatch(imageId, { flagged: d.flagged, rating: d.rating, note: d.note, ai_title: d.ai_title });
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "analysis failed");
      const fresh = await fetch("/api/images/" + imageId).then((r) => r.json());
      setImg(fresh);
      onRowPatch(imageId, { ai_title: fresh.ai_title, ai_description: fresh.ai_description });
      router.refresh(); // sidebar tag list may have grown
    } catch (e) {
      setError(e instanceof Error ? e.message : "analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function addToCollection(collectionId: number) {
    const r = await write("/api/collections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectionId, imageIds: [imageId] }),
    });
    if (!r.ok) {
      await dialogs.alert({ title: "Not filed", message: r.message });
      return;
    }
    const fresh = await fetch("/api/images/" + imageId).then((r) => r.json());
    setImg(fresh);
    router.refresh();
  }

  async function removeImage() {
    const ok = await dialogs.confirm({
      title: "Remove this image?",
      message: "The managed copy leaves the library; your original source file is untouched.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const gone = await write("/api/images/" + imageId, { method: "DELETE" });
    if (!gone.ok) {
      await dialogs.alert({ title: "Image not removed", message: gone.message });
      return;
    }
    onRemoved?.();
    onClose();
    router.refresh();
  }

  if (!img) {
    return (
      <aside className="inspector" aria-label="Image details">
        <div style={{ padding: "var(--space-4)", display: "flex", gap: 10, alignItems: "center" }}>
          <span className="spin" /> <span className="mono-label">Loading</span>
        </div>
      </aside>
    );
  }

  const folderOptions = collections
    .filter((c) => !img.collections.some((x) => x.id === c.id))
    .map((c) => ({ value: String(c.id), label: c.name, depth: c.depth }));

  const a = img.ai_analysis;
  const kb = (img.bytes / 1024).toFixed(0);

  return (
    <aside className="inspector" aria-label="Image details">
      <div style={{ position: "relative" }}>
        <a href={"/api/img/" + img.id + "?full=1"} target="_blank" rel="noreferrer" title="Open original">
          <img className="inspector__img" src={"/api/img/" + img.id} alt={img.ai_title || img.filename} />
        </a>
        <button
          className="inspector__x"
          onClick={onClose}
          aria-label="Close inspector"
        >
          <IconX width={18} height={18} />
        </button>
        {onBack && (
          <button
            className="btn is-ghost"
            style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.45)", color: "#fff", border: 0 }}
            onClick={onBack}
            aria-label="Back to previous image"
          >
            <IconArrowLeft width={13} height={13} />
            Back
          </button>
        )}
      </div>

      <div className="inspector__body">
        <div className="insp-section">
          <h2 className="insp-title">{img.ai_title || img.filename}</h2>
          {img.artist && <span className="mono-xs" style={{ color: "var(--text-secondary)" }}>by {img.artist}</span>}
          {img.ai_description && <p className="insp-desc">{img.ai_description}</p>}
        </div>

        <div className="flag-row">
          <button className="btn" onClick={runAnalysis} disabled={analyzing}>
            {analyzing ? <span className="spin" /> : <IconSparkle width={13} height={13} />}
            {analyzing ? "Working" : img.ai_at ? "Re-analyze" : "Analyze"}
          </button>
        </div>

        {analyzing && (
          <div className="analysis-wait" role="status">
            <span className="spin" />
            <div>
              <p>Reading the image</p>
              <span className="mono-xs">{elapsed}s · {img.ai_model || "groq vision"} · reasoning models take up to a minute</span>
            </div>
          </div>
        )}
        {error && !analyzing && (
          <div className="analysis-wait is-error" role="alert">
            <div>
              <p>Analysis failed</p>
              <span className="mono-xs">{error}</span>
            </div>
            <button className="btn" onClick={runAnalysis}>Retry</button>
          </div>
        )}

        {img.palette.length > 0 && (
          <div className="insp-section">
            <span className="mono-label">Palette</span>
            <div className="palette-strip">
              {img.palette.map((s, i) => (
                <button
                  key={i}
                  className="chip"
                  style={{ background: s.hex, flex: String(Math.max(0.08, s.pct)) }}
                  title={s.hex + "  " + (s.pct * 100).toFixed(1) + "%  (click to copy)"}
                  onClick={() => navigator.clipboard?.writeText(s.hex)}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="mono-xs">{img.palette[0]?.hex}</span>
              <span className="mono-xs">luma {(img.luma ?? 0).toFixed(2)} · chroma {(img.chroma ?? 0).toFixed(2)}</span>
            </div>
          </div>
        )}

        {a && !analyzing && (
          <div className="insp-section">
            <span className="mono-label">Visual analysis</span>
            <AnalysisBrief a={a} />
          </div>
        )}

        <div className="insp-section">
          <span className="mono-label">Tags</span>
          <div className="tag-row">
            {img.tags.map((t) => (
              <span key={t.id} className={"tag-pill" + (t.source === "ai" ? " is-ai" : "")} title={t.kind + (t.source === "ai" ? " · ai" : "")}>
                {t.name}
                <button onClick={() => patch({ removeTagId: t.id })} aria-label={"Remove tag " + t.name}>
                  <IconX width={9} height={9} />
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => { e.preventDefault(); if (tagInput.trim()) { patch({ addTag: tagInput }); setTagInput(""); } }}
              style={{ display: "inline-flex" }}
            >
              <input
                className="tag-pill"
                style={{ width: 90, cursor: "text", background: "transparent" }}
                placeholder="+ add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                aria-label="Add tag"
              />
            </form>
          </div>
        </div>

        {img.similar.length > 0 && (
          <div className="insp-section">
            <span className="mono-label">Similar in library</span>
            <div className="sim-strip">
              {img.similar.slice(0, 8).map((s) => (
                <button
                  key={s.other_id}
                  className="sim"
                  onClick={(e) => e.shiftKey
                    ? router.push("/diptych?a=" + imageId + "&b=" + s.other_id)
                    : onNavigate(s.other_id)}
                  title={(s.score * 100).toFixed(0) + "% similar · click to open · shift-click for diptych"}
                >
                  <img src={"/api/img/" + s.other_id} alt="" loading="lazy" />
                  <span className="pct">{(s.score * 100).toFixed(0)}</span>
                </button>
              ))}
            </div>
            <span className="mono-xs">shift-click a thumbnail to open it as a diptych</span>
          </div>
        )}

        <div className="insp-section">
          <span className="mono-label">Folders</span>
          <div className="tag-row">
            {img.collections.map((c) => <span key={c.id} className="tag-pill">{c.name}</span>)}
            {/* An image already in every folder has nowhere left to go, and
                offering "+ folder" there opens an empty menu: a control that
                looks broken rather than finished. */}
            {folderOptions.length > 0 && (
              <Select
                value={null}
                placeholder="+ folder"
                ariaLabel="Add to folder"
                variant="pill"
                onChange={(v) => addToCollection(Number(v))}
                options={folderOptions}
              />
            )}
            {folderOptions.length === 0 && img.collections.length === 0 && (
              <span className="mono-xs">no folders yet</span>
            )}
          </div>
        </div>

        <div className="insp-section">
          <span className="mono-label">Notes</span>
          <textarea
            className="note-box"
            defaultValue={img.note ?? ""}
            placeholder="Observations, what to iterate, where this fits..."
            onChange={(e) => {
              if (noteTimer.current) clearTimeout(noteTimer.current);
              const v = e.target.value;
              noteTimer.current = setTimeout(() => patch({ note: v }), 600);
            }}
          />
        </div>

        {img.prompt_text && (
          <div className="insp-section">
            <span className="mono-label">Generation prompt</span>
            <div className="ai-block"><p style={{ whiteSpace: "pre-wrap" }}>{img.prompt_text.slice(0, 1200)}</p></div>
          </div>
        )}

        <div className="insp-section">
          <span className="mono-label">File</span>
          <div className="stat-card" style={{ marginBottom: 0, padding: "8px 6px" }}>
            <dl className="kv" style={{ padding: "0 8px" }}>
              <dt>size</dt><dd>{img.width} × {img.height} · {kb} KB · {img.format}</dd>
              {img.ai_model && <><dt>model</dt><dd>{img.ai_model}</dd></>}
            </dl>
          </div>
        </div>

        <button className="btn is-danger" style={{ alignSelf: "flex-start" }} onClick={removeImage}>
          Remove from library
        </button>
      </div>
    </aside>
  );
}
