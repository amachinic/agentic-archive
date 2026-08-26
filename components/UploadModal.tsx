"use client";

import { useRef, useState } from "react";
import { IconUpload, IconCheck, IconX } from "./icons";

type FileState = { name: string; status: "queued" | "uploading" | "done" | "error"; error?: string; id?: number };

/*
  Upload as a proper modal: drop files on the zone or browse, watch each one
  land, done. Files go through /api/upload, which ingests into the library
  (Uploads collection) with the full local index.
*/
export default function UploadModal({
  onClose, onUploaded,
}: {
  onClose: () => void;
  onUploaded: (ids: number[]) => void;
}) {
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneIds = useRef<number[]>([]);

  async function start(list: FileList | File[]) {
    const picked = [...list].filter((f) => /image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i.test(f.name));
    if (!picked.length || busy) return;
    setBusy(true);
    setFiles(picked.map((f) => ({ name: f.name, status: "queued" })));

    for (let i = 0; i < picked.length; i++) {
      setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, status: "uploading" } : f)));
      try {
        const fd = new FormData();
        fd.append("file", picked[i]);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "upload failed");
        doneIds.current.push(d.id);
        setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, status: "done", id: d.id } : f)));
      } catch (e) {
        setFiles((fs) => fs.map((f, j) => (j === i
          ? { ...f, status: "error", error: e instanceof Error ? e.message.slice(0, 120) : "failed" }
          : f)));
      }
    }
    setBusy(false);
  }

  const finished = files.length > 0 && !busy;

  function close() {
    if (doneIds.current.length) onUploaded(doneIds.current);
    onClose();
  }

  return (
    <div className="dlg-veil" onMouseDown={() => { if (!busy) close(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="Upload images" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="dlg__title">Upload images</h3>
        <p className="dlg__message">Files are copied into the library&apos;s Uploads folder and indexed: palette, similarity, the lot. Originals stay where they are.</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) start(e.target.files); }}
        />

        {files.length === 0 ? (
          <button
            className={"dropzone" + (over ? " is-over" : "")}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); start(e.dataTransfer.files); }}
          >
            <IconUpload width={22} height={22} />
            <span>Drop images here</span>
            <span className="mono-xs">or click to browse</span>
          </button>
        ) : (
          <div className="upload-list">
            {files.map((f, i) => (
              <div key={i} className={"upload-row" + (f.status === "error" ? " is-error" : "")}>
                {f.status === "uploading" && <span className="spin" />}
                {f.status === "done" && <IconCheck width={13} height={13} style={{ color: "var(--accent)" }} />}
                {f.status === "error" && <IconX width={13} height={13} style={{ color: "#dc2626" }} />}
                {f.status === "queued" && <span className="upload-dot" />}
                <span className="upload-row__name">{f.name}</span>
                <span className="mono-xs">{f.status === "error" ? f.error : f.status}</span>
              </div>
            ))}
          </div>
        )}

        <div className="dlg__foot">
          {finished ? (
            <button className="btn is-primary" onClick={close}>Done</button>
          ) : (
            <button className="btn is-ghost" onClick={close} disabled={busy}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
