"use client";

/*
  The Analyze studio: pick an image (upload or library) on the left, get the
  complete visual analysis as a brief on the right, then interrogate it in the
  conversation below: materials, lighting, lineage, history, whatever.
*/

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Analysis, ChatMsg } from "@/lib/vision";
import AnalysisBrief from "./AnalysisBrief";
import UploadModal from "./UploadModal";
import GlyphLoader from "./GlyphLoader";
import { useDragScroll } from "./useDragScroll";
import { IconSearch, IconUpload, IconX } from "./icons";

type PickerItem = { id: number; title: string; w: number; h: number };
type Detail = { id: number; ai_at: number | null; ai_analysis: Analysis | null; ai_title: string | null; filename: string };

export default function AnalyzeView({
  initialPicker, initialId,
}: {
  initialPicker: PickerItem[]; initialId: number | null;
}) {
  const router = useRouter();
  const [picker, setPicker] = useState(initialPicker);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(initialId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [pickerVersion, setPickerVersion] = useState(0);

  const pickerDrag = useDragScroll();
  const [thread, setThread] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const ranFor = useRef<number | null>(null);

  /* the empty studio IS a dropzone: files land, upload, and analysis starts
     immediately — no CTA, no modal in between */
  const [dropBusy, setDropBusy] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const dropInputRef = useRef<HTMLInputElement>(null);

  async function uploadDirect(list: FileList | File[]) {
    const picked = [...list].filter((f) => /image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i.test(f.name));
    if (!picked.length || dropBusy) return;
    setDropBusy(true);
    setDropNote(null);
    const ids: number[] = [];
    for (const f of picked) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "upload failed");
        ids.push(d.id);
      } catch (e) {
        setDropNote((e instanceof Error ? e.message.slice(0, 120) : "upload failed") + " · " + f.name);
      }
    }
    setDropBusy(false);
    if (ids.length) {
      setSelected(ids[0]); // selection auto-runs the analysis
      setPickerVersion((v) => v + 1);
      router.refresh();
    }
  }

  // search the library picker
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch("/api/list?limit=60&q=" + encodeURIComponent(q));
      const d = await res.json();
      setPicker(d.rows.map((r: { id: number; ai_title: string | null; filename: string; width: number | null; height: number | null }) => ({
        id: r.id, title: r.ai_title || r.filename, w: r.width ?? 1, h: r.height ?? 1,
      })));
    }, 300);
    return () => clearTimeout(t);
  }, [q, pickerVersion]);

  // load detail + auto-analyze on selection; picking a new image resets the thread
  useEffect(() => {
    if (selected == null) { setDetail(null); return; }
    let alive = true;
    setDetail(null);
    setThread([]);
    setError(null);
    fetch("/api/images/" + selected)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (!d.ai_at && ranFor.current !== selected) {
          ranFor.current = selected;
          runAnalysis(selected);
        }
      })
      .catch(() => { if (alive) setError("Failed to load image"); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (!analyzing) { setElapsed(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [analyzing]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread, chatBusy]);

  async function runAnalysis(id: number) {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "analysis failed");
      const fresh = await fetch("/api/images/" + id).then((r) => r.json());
      setDetail(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || chatBusy || selected == null) return;
    const next: ChatMsg[] = [...thread, { role: "user", content: text }];
    setThread(next);
    setDraft("");
    setChatBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: selected, messages: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "chat failed");
      setThread([...next, { role: "assistant", content: d.reply }]);
    } catch (e) {
      setThread([...next, { role: "assistant", content: "That failed: " + (e instanceof Error ? e.message : "unknown error") + " . Try again." }]);
    } finally {
      setChatBusy(false);
    }
  }

  const a = detail?.ai_analysis ?? null;

  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Analyze</h1>
          <span className="mono-xs">upload or pick an image · complete visual analysis · ask anything about it</span>
        </div>
        <div className="topbar__spacer" />
      </header>

      <div className="work">
        <main className="pane pane--flush" tabIndex={-1}>
          <div className="analyze">
            {/* ---- picker ---- */}
            <div className="analyze__picker" {...pickerDrag}>
              <button className="btn is-primary analyze__upload" onClick={() => setShowUpload(true)}>
                <IconUpload width={13} height={13} />
                Upload images
              </button>
              <div className="field">
                <IconSearch width={13} height={13} />
                <input placeholder="Search the library..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" />
              </div>
              <div className="analyze__grid">
                {picker.map((p) => (
                  <button
                    key={p.id}
                    className={"analyze__thumb" + (selected === p.id ? " is-selected" : "")}
                    onClick={() => setSelected(p.id)}
                    title={p.title}
                  >
                    <img src={"/api/img/" + p.id} alt={p.title} loading="lazy" style={{ aspectRatio: p.w + " / " + p.h }} />
                  </button>
                ))}
              </div>
            </div>

            {/* ---- brief + conversation ---- */}
            <div className="analyze__main">
              {selected == null ? (
                <div className="empty">
                  <input
                    ref={dropInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files?.length) uploadDirect(e.target.files); e.target.value = ""; }}
                  />
                  <button
                    className={"dropzone analyze__drop" + (dropOver ? " is-over" : "")}
                    onClick={() => dropInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDropOver(true); }}
                    onDragLeave={() => setDropOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDropOver(false); uploadDirect(e.dataTransfer.files); }}
                    disabled={dropBusy}
                  >
                    {dropBusy ? (
                      <>
                        <span className="spin" />
                        <span>Uploading</span>
                        <span className="mono-xs">analysis starts the moment it lands</span>
                      </>
                    ) : (
                      <>
                        <IconUpload width={22} height={22} />
                        <span>Drop images here</span>
                        <span className="mono-xs">or click to browse · analysis starts immediately</span>
                      </>
                    )}
                  </button>
                  {dropNote && <span className="mono-xs" style={{ color: "#dc2626" }}>{dropNote}</span>}
                  <h2>Analyze an image</h2>
                  <p>Upload an image or choose one from the library. You get the complete visual analysis: material, lighting, aesthetic, technique, time period, artist references, history, plus a conversation to dig further.</p>
                </div>
              ) : (
                <div className="analyze__scroll">
                  <div className="analyze__hero">
                    <img src={"/api/img/" + selected} alt={detail?.ai_title || "Selected image"} />
                    <button
                      className="xbtn analyze__close"
                      onClick={() => { setSelected(null); window.history.replaceState(null, "", "/analyze"); }}
                      aria-label="Close and go back"
                      title="Close"
                    >
                      <IconX width={12} height={12} />
                    </button>
                  </div>

                  {analyzing && (
                    <div className="analysis-wait" role="status">
                      <span className="spin" />
                      <div>
                        <p>Reading the image</p>
                        <span className="mono-xs">{elapsed}s · full pass takes up to a minute</span>
                      </div>
                    </div>
                  )}
                  {error && !analyzing && (
                    <div className="analysis-wait is-error" role="alert">
                      <div>
                        <p>Something failed</p>
                        <span className="mono-xs">{error}</span>
                      </div>
                      <button className="btn" onClick={() => runAnalysis(selected)}>Retry</button>
                    </div>
                  )}

                  {a && !analyzing && (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <h2 className="insp-title">{detail?.ai_title}</h2>
                        <div className="topbar__spacer" />
                        <button className="btn is-ghost" onClick={() => runAnalysis(selected)}>Re-analyze</button>
                      </div>
                      <AnalysisBrief a={a} />
                    </>
                  )}

                  <div className="chatbox">
                    <span className="mono-label">Conversation</span>
                    {thread.length === 0 && !chatBusy && (
                      <p className="chatbox__hint">
                        Ask anything about this image: what material is that, how would this light be set up, what era does the typography belong to, how do I push this further.
                      </p>
                    )}
                    {thread.map((m, i) => (
                      <div key={i} className={"chat-msg " + (m.role === "user" ? "is-user" : "is-ai")}>
                        <span className="mono-xs">{m.role === "user" ? "you" : "atlas"}</span>
                        <p>{m.content}</p>
                      </div>
                    ))}
                    {chatBusy && (
                      <div className="chat-msg is-ai">
                        <span className="mono-xs">atlas</span>
                        <p style={{ display: "flex", alignItems: "center", gap: 8 }}><GlyphLoader size={15} /> thinking about it</p>
                      </div>
                    )}
                    <div ref={threadEndRef} />
                    <form
                      className="chatbox__input"
                      onSubmit={(e) => { e.preventDefault(); send(); }}
                    >
                      <textarea
                        className="note-box"
                        style={{ minHeight: 44 }}
                        placeholder="Ask about material, lighting, history, technique..."
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                        disabled={chatBusy}
                      />
                      <button className="btn is-primary" type="submit" disabled={chatBusy || !draft.trim()}>Send</button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={(ids) => {
            if (ids.length) setSelected(ids[0]);
            setPickerVersion((v) => v + 1); // refresh the picker grid
            router.refresh();               // sidebar counts (Uploads folder)
          }}
        />
      )}
    </>
  );
}
