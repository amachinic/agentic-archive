"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Swatch } from "@/lib/imaging";
import type { Comparison } from "@/lib/vision";
import { IconArrowLeft } from "./icons";

type Pane = {
  id: number; filename: string; title: string;
  width: number | null; height: number | null; bytes: number; format: string | null;
  palette: Swatch[]; luma: number | null; chroma: number | null; flagged: number;
};

export default function DiptychView({
  a, b, metrics,
}: {
  a: Pane; b: Pane; metrics: { phashD: number; colorD: number; score: number };
}) {
  const router = useRouter();
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [working, setWorking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function runComparison() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compare: [a.id, b.id] }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "comparison failed");
      setComparison(d.comparison);
    } catch (e) {
      setError(e instanceof Error ? e.message : "comparison failed");
    } finally {
      setWorking(false);
    }
  }

  // A stored comparison for this pair is reused; otherwise run one now.
  useEffect(() => {
    let alive = true;
    fetch("/api/compare?a=" + a.id + "&b=" + b.id)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.comparison) setComparison(d.comparison);
        else runComparison();
      })
      .catch(() => { if (alive) runComparison(); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b.id]);

  useEffect(() => {
    if (!working) { setElapsed(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [working]);

  const winner = comparison?.stronger === "a" ? a.id : comparison?.stronger === "b" ? b.id : null;

  return (
    <>
      <header className="topbar">
        <button className="btn is-ghost" onClick={() => router.back()} aria-label="Go back" style={{ paddingLeft: 10, paddingRight: 10 }}>
          <IconArrowLeft width={14} height={14} />
          Back
        </button>
        <div className="topbar__lede">
          <h1 className="topbar__title">Diptych</h1>
          <span className="pill pill--static">
            {(metrics.score * 100).toFixed(0)}% similar · structure Δ {metrics.phashD}/64 · colour Δ {(metrics.colorD * 100).toFixed(1)}%
          </span>
        </div>
        <div className="topbar__spacer" />
        <button className="btn" onClick={() => router.push("/diptych?a=" + b.id + "&b=" + a.id)}>Swap</button>
        <button className="btn" onClick={runComparison} disabled={working}>
          {working ? <span className="spin" /> : null}
          {working ? "Comparing" : comparison ? "Re-run comparison" : "Compare"}
        </button>
      </header>

      <div className="work">
        <main className="pane" tabIndex={-1}>
          <div className="diptych">
            {[{ p: a, tag: "A" }, { p: b, tag: "B" }].map(({ p, tag }) => (
              <figure className="diptych__pane" key={p.id}>
                <a href={"/api/img/" + p.id + "?full=1"} target="_blank" rel="noreferrer">
                  <img
                    src={"/api/img/" + p.id}
                    alt={p.title}
                    className={winner === p.id ? "is-winner" : ""}
                  />
                </a>
                <figcaption>
                  <div className="diptych__head">
                    <span className="mono-label">{tag}{winner === p.id ? " · stronger" : ""}</span>
                    <Link className="mono-xs" href={"/?q=" + encodeURIComponent(p.filename)}>open in library</Link>
                  </div>
                  <h2 className="insp-title" style={{ fontSize: "var(--font-body-md)" }}>{p.title}</h2>
                  {p.palette.length > 0 && (
                    <div className="palette-strip" style={{ marginTop: 6 }}>
                      {p.palette.map((s, i) => (
                        <button
                          key={i}
                          className="chip"
                          style={{ background: s.hex, flex: String(Math.max(0.08, s.pct)), height: 22 }}
                          title={s.hex + " (click to copy)"}
                          onClick={() => navigator.clipboard?.writeText(s.hex)}
                        />
                      ))}
                    </div>
                  )}
                  <span className="mono-xs" style={{ display: "block", marginTop: 6 }}>
                    {p.width} × {p.height} · {(p.bytes / 1024).toFixed(0)} KB · luma {(p.luma ?? 0).toFixed(2)} · chroma {(p.chroma ?? 0).toFixed(2)}
                  </span>
                </figcaption>
              </figure>
            ))}

            <div className="diptych__analysis">
              {working && (
                <div className="analysis-wait" role="status">
                  <span className="spin" />
                  <div>
                    <p>Reading both images</p>
                    <span className="mono-xs">{elapsed}s · comparative pass takes up to a minute</span>
                  </div>
                </div>
              )}
              {error && !working && (
                <div className="analysis-wait is-error" role="alert">
                  <div>
                    <p>Comparison failed</p>
                    <span className="mono-xs">{error}</span>
                  </div>
                  <button className="btn" onClick={runComparison}>Retry</button>
                </div>
              )}
              {comparison && !working && (
                <div className="ai-block">
                  <h4>Verdict</h4><p>{comparison.verdict}</p>
                  <h4>Shared</h4><p>{comparison.shared.join(" · ")}</p>
                  <h4>Differences</h4><p>{comparison.differences.join(" · ")}</p>
                  <h4>{comparison.stronger === "neither" ? "Neither wins" : "Why " + comparison.stronger.toUpperCase() + " is stronger"}</h4>
                  <p>{comparison.why}</p>
                  <h4>How to diverge</h4><p>{comparison.how_to_diverge}</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
