"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/vision";
import { IconCopy, IconCheck } from "./icons";

/**
 * The complete visual analysis, one block, with a copy CTA that takes the
 * whole brief out as clean plain text. Older stored analyses predate some
 * fields, so every row is conditional; a re-analyze fills them in.
 */

const ROWS: [string, (a: Analysis) => string | undefined][] = [
  ["Material", (a) => a.material],
  ["Lighting", (a) => a.lighting],
  ["Aesthetic", (a) => a.aesthetic],
  ["Technique", (a) => a.technique],
  ["Time period", (a) => a.time_period],
  ["Artist reference", (a) => a.artist_reference],
  ["History", (a) => a.historical_context],
  ["Composition", (a) => a.composition],
  ["Color", (a) => a.color_reading],
  ["Critique", (a) => a.critique],
  ["How to differentiate", (a) => a.differentiation],
];

/** The full analysis as paste-ready plain text. */
export function analysisToText(a: Analysis): string {
  const lines: string[] = [];
  if (a.title) lines.push(a.title, "");
  if (a.description) lines.push(a.description, "");
  const kindLine = [a.work, a.carrier && a.carrier !== "direct" ? "via " + a.carrier : "", a.period && a.period !== "undated" ? a.period : ""].filter(Boolean).join(" · ");
  if (kindLine) lines.push("Work: " + kindLine);
  else if (a.medium) lines.push("Medium: " + a.medium);
  if (a.style?.length) lines.push("Style: " + a.style.join(", "));
  if (a.mood?.length) lines.push("Mood: " + a.mood.join(", "));
  if (a.subjects?.length) lines.push("Subjects: " + a.subjects.join(", "));
  const head = lines.length;
  for (const [label, get] of ROWS) {
    const v = get(a);
    if (v) lines.push(label + ": " + v);
  }
  // blank line between the tag block and the prose block, when both exist
  if (head > 0 && lines.length > head) lines.splice(head, 0, "");
  return lines.join("\n").trim();
}

export default function AnalysisBrief({ a }: { a: Analysis }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copyAll() {
    const text = analysisToText(a);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API blocked: fall back to a transient textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="ai-block">
      <button
        className={"copy-cta" + (copied ? " is-copied" : "")}
        onClick={copyAll}
        title="Copy the complete analysis as text"
        aria-label="Copy the complete analysis"
      >
        {copied ? <IconCheck width={11} height={11} /> : <IconCopy width={11} height={11} />}
        {copied ? "Copied" : "Copy"}
      </button>

      {(a.work || a.medium || a.style?.length > 0 || a.mood?.length > 0) && (
        <div className="chips" style={{ paddingRight: 72 }}>
          {(a.work || a.medium) && <span className="term is-medium">{a.work || a.medium}</span>}
          {a.period && a.period !== "undated" && <span className="term is-medium">{a.period}</span>}
          {a.style?.map((t) => <span key={"s" + t} className="term">{t}</span>)}
          {a.mood?.map((t) => <span key={"m" + t} className="term is-soft">{t}</span>)}
        </div>
      )}
      {a.subjects?.length > 0 && (<><h4>Subjects</h4><p>{a.subjects.join(" · ")}</p></>)}
      {ROWS.map(([label, get]) => {
        const v = get(a);
        return v ? (
          <div key={label}>
            <h4>{label}</h4>
            <p>{v}</p>
          </div>
        ) : null;
      })}
    </div>
  );
}
