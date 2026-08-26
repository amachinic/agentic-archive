"use client";

/*
  One agent, three lenses. Atlas is the only mind; the archetypes below are
  capability namespaces it reasons through — the Archivist names things, the
  Curator decides what belongs together, the Media Manager files and ships.
  Hand-off between them is shared data (vocabulary, palettes, fingerprints),
  never messages you can't see. Autonomy is a SETTING per archetype.
*/

import { useEffect, useState } from "react";
import ArchetypePix, { type PixMode } from "./ArchetypePix";
import { IconCaret } from "./icons";

type Archetype = {
  key: string;
  mode: PixMode;
  name: string;
  autonomy: "acts" | "proposes" | "read-only";
  desc: string;
  tools: string[];
  status: string;
  budget: string;
};

const ARCHETYPES: Archetype[] = [
  {
    key: "archivist", mode: "scan", name: "Archivist", autonomy: "proposes",
    desc: "Names what a thing is. Tags new images against your existing vocabulary first and mints a new keyterm only when nothing fits; keeps meta tags, duplicates and the history honest.",
    tools: ["tag_images", "mint_keyterm", "meta_tags", "dedupe", "history"],
    status: "live · analyze studio", budget: "vision · per image",
  },
  {
    key: "curator", mode: "forms", name: "Curator", autonomy: "acts",
    desc: "Decides what belongs together. Finds, filters, sequences and sorts the canvas, and because its sort keys are the Archivist's own keyterms and palettes, the hand-off is invisible.",
    tools: ["find", "filter", "sort_field", "sequence", "build_collection"],
    status: "live · in the Network panel", budget: "per turn · ~2k tokens",
  },
  {
    key: "manager", mode: "drop", name: "Media Manager", autonomy: "proposes",
    desc: "Files and ships. Keeps folders digital in Atlas, mirrors them to disk as real files under ~/Atlas Exports when you ask, and always asks where a thing should live. Originals are never touched.",
    tools: ["keep_digital", "export_disk", "create_folder", "collect"],
    status: "live · save a folder", budget: "0 tokens (local)",
  },
];

const GUIDELINES: [string, string][] = [
  ["One brain, three lenses", "There is exactly one agent. The archetypes are capability namespaces Atlas reasons through, not separate minds: nothing has to be explained twice and no archetype can disagree with another."],
  ["Hand-off is shared data", "Archetypes coordinate through the same vocabulary, palettes and fingerprints, never through messages you can't see. The Curator sorts with the Archivist's keys; the Media Manager files what the Curator built."],
  ["Autonomy is a setting", "Every archetype holds one of two levels today. ACTS may change what you see (the field, an arrangement) but never the library. PROPOSES may only stage changes for your accept."],
  ["The library is written once", "Exactly one door writes agent intentions into the library: an accepted proposal. Atlas never creates, files, merges or deletes directly: you accept, or nothing happens."],
  ["Local first", "Fingerprints, keyterms, palettes and similarity are free. Atlas reasons against local tools by default and spends model tokens only where language or vision genuinely helps."],
  ["Everything is visible", "Four doors (conversation, CTAs, “/” commands, contextual triggers) route into the same actions. Every tool call renders in the thread as it happens, and /history keeps the session’s record."],
];

export default function AgentsView() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [openRule, setOpenRule] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("atlas-agents-enabled");
      if (v) setEnabled(JSON.parse(v));
    } catch { /* first run */ }
  }, []);
  const isOn = (key: string) => enabled[key] !== false;
  const toggle = (key: string) => {
    setEnabled((e) => {
      const next = { ...e, [key]: !(e[key] !== false) };
      try { localStorage.setItem("atlas-agents-enabled", JSON.stringify(next)); } catch { /* ok */ }
      return next;
    });
  };

  return (
    <div className="agents">
      <div className="agents__hero">
        <div className="agentcard__top">
          <span className="agentcard__pix"><ArchetypePix mode="atlas" size={30} /></span>
          <span className="agentcard__name">Atlas</span>
          <span className="agentcard__auto is-proposes">proposes</span>
        </div>
        <p className="agentcard__desc">
          One agent with three lenses. Atlas plans in the Network conversation, works the
          library&apos;s own local tools first, and stages every write as a proposal you accept
          or reject. The archetypes below are its capability namespaces, not separate minds.
        </p>
        <div className="agents__doors">
          <span className="agents__door">conversation</span>
          <span className="agents__door">home CTAs</span>
          <span className="agents__door">&ldquo;/&rdquo; commands</span>
          <span className="agents__door">contextual triggers</span>
        </div>
        <div className="agentcard__foot">
          <span className={"agentcard__status" + (isOn("atlas") ? " is-on" : "")}>
            <i />{isOn("atlas") ? "live · in the Network panel" : "switched off"}
          </span>
          <span className="agentcard__budget">per turn · ~2k tokens</span>
          <button
            className={"agentcard__switch" + (isOn("atlas") ? " on" : "")}
            role="switch"
            aria-checked={isOn("atlas")}
            aria-label="Enable Atlas"
            title="Switching Atlas off silences the agent everywhere"
            onClick={() => toggle("atlas")}
          />
        </div>
      </div>

      <div className="agents__grid">
        {ARCHETYPES.map((a) => (
          <div key={a.key} className={"agentcard" + (isOn("atlas") && isOn(a.key) ? " is-live" : "")}>
            <div className="agentcard__top">
              <span className="agentcard__pix"><ArchetypePix mode={a.mode} size={30} /></span>
              <span className="agentcard__name">{a.name}</span>
              <span className={"agentcard__auto is-" + a.autonomy.replace("read-only", "read")}>{a.autonomy}</span>
            </div>
            <p className="agentcard__desc">{a.desc}</p>
            <div className="agentcard__tools">
              {a.tools.map((t) => <span key={t} className="agentcard__tool">{t}</span>)}
            </div>
            <div className="agentcard__foot">
              <span className={"agentcard__status" + (isOn("atlas") && isOn(a.key) ? " is-on" : "")}>
                <i />{isOn("atlas") && isOn(a.key) ? a.status : "switched off"}
              </span>
              <span className="agentcard__budget">{a.budget}</span>
              <button
                className={"agentcard__switch" + (isOn(a.key) ? " on" : "")}
                role="switch"
                aria-checked={isOn(a.key)}
                aria-label={"Enable the " + a.name}
                title={"Switching the " + a.name + " off retires its capabilities"}
                onClick={() => toggle(a.key)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="agents__rules">
        <span className="mono-label">Guidelines</span>
        {GUIDELINES.map(([t, body], i) => (
          <div key={i} className={"rule" + (openRule === i ? " is-open" : "")}>
            <button
              className="rule__head"
              onClick={() => setOpenRule((v) => (v === i ? null : i))}
              aria-expanded={openRule === i}
            >
              <span className="rule__n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3>
              <IconCaret width={13} height={13} />
            </button>
            <div className="rule__body">
              <div><p>{body}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
