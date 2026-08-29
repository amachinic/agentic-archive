"use client";

/*
  The Network as a holographic playground field.

  Every image owns a fixed HOME on an infinite plane (a centre-out spiral with
  organic jitter; Tree mode swaps in iteration-forest homes instead). But only
  a capped number of cards are ALIVE at once: panning into fresh ground spawns
  the images that live there (scale+fade in), leaving ground despawns them.
  The cap is a slider; a keyterm filter narrows the pool seamlessly. No global
  physics, viewport culling, lazy 320px thumbs: the canvas stays light no
  matter how big the library grows.

  Cards are Weave-style nodes: title header, image body, side ports. Wires are
  ComfyUI beziers between live cards; dragging out of a port onto another card
  creates a manual link.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";
import { useRouter, useSearchParams } from "next/navigation";
import Inspector from "./Inspector";
import { useDialogs } from "./DialogProvider";
import { write } from "@/lib/write";
import GlyphLoader from "./GlyphLoader";
import Select from "./Select";
import { IconX, IconPlus, IconCheck, IconCaret, IconChevronDown, IconTag, IconSearch, IconSave, IconSort, IconClock, IconDrive, IconPalette, IconRefresh, IconFolder, IconSparkle, IconUndo, IconCopy, IconTrash, IconAgent } from "./icons";
import ThemeToggle from "./ThemeToggle";
import ToolCheck from "./ToolCheck";
import type { PixMode } from "./ArchetypePix";
import type { ChatMsg } from "@/lib/vision";

export type Keyterm = { id: number; name: string; kind: string; count: number };

/* The preloader and field share a document, so readiness is a tiny DOM
   contract rather than a second set of network requests. The dataset keeps
   the latest value if the animation runtime arrives after this component. */
function reportAtlasBoot(progress: number, ready = false) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.atlasBoot !== "loading") return;
  const previous = Number(root.dataset.atlasBootProgress) || 0;
  const next = ready ? 100 : Math.max(previous, Math.min(99, Math.round(progress)));
  root.dataset.atlasBootProgress = String(next);
  window.dispatchEvent(new CustomEvent("atlas:boot-progress", { detail: { progress: next } }));
  if (ready) {
    root.dataset.atlasBootReady = "true";
    window.dispatchEvent(new CustomEvent("atlas:boot-ready"));
  }
}

/*
  The opening reveal, in milliseconds.

  Loading and showing are different questions. Thumbnails decode while the
  preloader still owns the screen -- that is the point of loading behind it --
  so by the time the cover lifts every card already holds a finished picture,
  and the field would simply BE there. Instead each card keeps drawing its
  skeleton until this wave reaches it, then crosses into its image.

  The wave moves out from the middle of the view, which is where the spiral
  starts, so the field fills the way it is laid out rather than in whatever
  order the live map happens to iterate.

  REVEAL_SPAN is the point past which no card can still be waiting, so it also
  serves as the cue for the panel that comes in behind the pictures.
*/
const REVEAL_FADE = 420;    // one card, skeleton to picture
const REVEAL_SPREAD = 0.9;  // ms of delay per screen pixel out from the centre
const REVEAL_LEAD = 700;    // the longest any card is made to wait its turn
const REVEAL_SPAN = REVEAL_LEAD + REVEAL_FADE;

/* the conversation holds more than words: tool calls the agent made, and
   proposals waiting on the human */
type ThreadItem =
  | { type: "msg"; role: "user" | "assistant"; content: string }
  | { type: "tool"; tool: string; detail: string; result: string; status: "running" | "done" }
  /* the turn's head: ATLAS speaking from inside the thread, narrating what
     is being done; the tool rows nest beneath it and the reply closes the
     block (treatment I from the presence sandbox) */
  | { type: "head"; what: string; status: "running" | "done" }
  | { type: "proposal"; name: string; note: string; ids: number[]; status: "pending" | "accepted" | "rejected" }
  | { type: "ctas"; options: CtaOpt[]; picked: string | null }
  | { type: "timeline" }
  | { type: "outcome"; rows: OutRow[] }
  | { type: "skills" }
  /* what search_outside found: outside the library, so shown here in the
     conversation rather than on the canvas, which draws by image id */
  | { type: "candidates"; query: string; items: Candidate[]; totals?: Record<string, number> }
  /* the follow-up surface after an outside hunt: checkable narrows, a
     source to go deeper into, and a line of the human's own words — all
     layered into ONE refined hunt. sent: null = live, a string = the
     refinement that went, "-" = passed over by a newer prompt. */
  | { type: "refine"; base: string; sources: { id: string; total: number | null }[]; sent: string | null };

type Candidate = {
  source: string; remoteId: string; title: string;
  creator: string | null; pageUrl: string | null; thumbUrl: string | null;
  licence: string | null; keepable: boolean;
};

type CtaOpt = { key: string; label: string; sub?: string };
type Action = { kind: "cta"; key: string; label: string } | { kind: "prompt"; text: string };
type Step = {
  thread: ThreadItem[];
  promptIds: number[] | null;
  fieldSort: FieldSortMode | null;
  action: Action;
};
type OutRow = { icon: "folder" | "foldercheck" | "drive" | "check"; text: string };

/* every door into the agent — conversation, home CTAs, the "/" palette,
   contextual triggers — routes into the same keyed actions, so the doors
   can never drift apart */
const COMMANDS = [
  { cmd: "/find", key: "find", label: "Find something", hint: "hunt the library, re-form the field", arch: "curator" },
  { cmd: "/sort", key: "sort", label: "Sort the canvas", hint: "re-order the spiral by colour or light", arch: "curator" },
  { cmd: "/tag", key: "tag", label: "Tag my new images", hint: "keyterms for the un-analyzed", arch: "archivist" },
  { cmd: "/save", key: "save", label: "Save a folder", hint: "keep digital, mirror to disk, or both", arch: "media manager" },
  { cmd: "/history", key: "timeline", label: "History", hint: "everything from this session, in order", arch: "atlas" },
];

/* Every tool the panel can show, attributed to the lens doing it and spoken
   as a task rather than a call. The row leads with the lens's own ident —
   ArchetypePix verb while running, pixel check once done — and the raw
   tool(args) form survives on hover and in the ledger. */
const TOOL_META: Record<string, { who: string; mode: PixMode; task: string }> = {
  search_library: { who: "curator", mode: "forms", task: "hunting the library" },
  filter_by_terms: { who: "curator", mode: "forms", task: "narrowing by keyterms" },
  expand_similar: { who: "curator", mode: "forms", task: "widening to what resembles it" },
  show_field: { who: "curator", mode: "forms", task: "re-forming the field" },
  sort_field: { who: "curator", mode: "forms", task: "re-ordering the grid" },
  release_field: { who: "curator", mode: "forms", task: "releasing the field" },
  search_outside: { who: "historian", mode: "seek", task: "searching the connected sources" },
  propose_folder: { who: "media manager", mode: "drop", task: "staging a folder for your accept" },
  create_collection: { who: "media manager", mode: "drop", task: "filing the folder" },
  add_to_collection: { who: "media manager", mode: "drop", task: "placing the images in it" },
  export_folder: { who: "media manager", mode: "drop", task: "mirroring real files to disk" },
  scan_duplicates: { who: "archivist", mode: "scan", task: "scanning for doubles" },
  remove_duplicates: { who: "archivist", mode: "scan", task: "removing the lesser copies" },
};
/* the verb each capability performs, drawn rather than spelled */
type IconFn = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;
const CTA_ICON: Record<string, IconFn> = {
  tag: IconTag,
  sort: IconSort, "sort-colour": IconPalette, "sort-light": IconSparkle, "sort-off": IconRefresh,
  "sort-period": IconSort, "sort-kind": IconFolder,
  find: IconSearch,
  save: IconSave, "save-atlas": IconFolder, "save-disk": IconDrive, "save-both": IconSave,
  timeline: IconClock,
  "post-save": IconFolder, "post-release": IconRefresh,
  "save-new": IconPlus, "save-existing": IconFolder, "save-local": IconDrive,
  filter: IconTag, dedupe: IconCheck, "dedupe-go": IconTrash, skills: IconAgent,
  "go-analyze": IconSparkle,
};
const ctaIcon = (key: string): IconFn | null =>
  key.startsWith("folder:") || key.startsWith("into:") ? IconFolder
    : key.startsWith("disk:") ? IconDrive
    : key.startsWith("term:") ? IconTag
    : CTA_ICON[key] ?? null;

const CTA_META: Record<string, CtaOpt> = {
  tag: { key: "tag", label: "Tag my new images", sub: "archivist" },
  dedupe: { key: "dedupe", label: "Find duplicates", sub: "archivist" },
  timeline: { key: "timeline", label: "History", sub: "archivist" },
  find: { key: "find", label: "Find something", sub: "curator" },
  filter: { key: "filter", label: "Filter by keyterm", sub: "curator" },
  sort: { key: "sort", label: "Sort the canvas", sub: "curator" },
  "post-release": { key: "post-release", label: "Show everything again", sub: "curator" },
  save: { key: "save", label: "Save a folder", sub: "media manager" },
  "save-new": { key: "save-new", label: "Create a new folder", sub: "media manager" },
  "save-existing": { key: "save-existing", label: "Save into an existing folder", sub: "media manager" },
  "save-local": { key: "save-local", label: "Save to a local folder", sub: "media manager" },
  skills: { key: "skills", label: "Other agent skills", sub: "atlas" },
};
const HOME_CTAS: CtaOpt[] = [CTA_META.tag, CTA_META.sort, CTA_META.find, CTA_META.save, CTA_META.skills];
/* The hosted archive reads. The agent runs there, so finding is offered and so
   is everything the field does on its own. What is not offered is what writes:
   tag changes the archive and save files a folder, and both are refused by the
   middleware, so putting them here would be offering a 403. */
const READ_ONLY_CTAS: CtaOpt[] = [CTA_META.find, CTA_META.filter, CTA_META.sort, CTA_META.skills];

/* everything Atlas can actually do today, under the archetype that owns it */
const SKILLS: { arch: string; note: string; keys: string[] }[] = [
  { arch: "Archivist", note: "knows what things are", keys: ["tag", "dedupe", "timeline"] },
  { arch: "Curator", note: "decides what belongs together", keys: ["find", "filter", "sort", "post-release"] },
  { arch: "Media Manager", note: "puts things where they live", keys: ["save-new", "save-existing", "save-local"] },
];

type FieldSortMode = "colour" | "light" | "period" | "kind";
const KIND_ORDER = ["artist", "work", "carrier", "period", "style", "subject", "mood", "color", "material", "process", "format", "medium", "tag"] as const;
const KIND_LABEL: Record<string, string> = {
  artist: "Artist", work: "Work", carrier: "Carrier", period: "Period", style: "Style", subject: "Subject", mood: "Mood",
  color: "Color", material: "Material", process: "Process", format: "Format", medium: "Medium", tag: "Manual",
};
const TERM_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function alphabetizeTerms(items: Keyterm[]) {
  return [...items].sort((a, b) => TERM_COLLATOR.compare(a.name, b.name) || a.id - b.id);
}

function FilterCheckboxRow({
  term,
  checked,
  onToggle,
  tabIndex,
}: {
  term: Keyterm;
  checked: boolean;
  onToggle: (name: string) => void;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      className={"frow" + (checked ? " is-on" : "")}
      onClick={() => onToggle(term.name)}
      role="checkbox"
      aria-checked={checked}
      tabIndex={tabIndex}
      title={checked ? "Deselect " + term.name : "Also require " + term.name}
    >
      <span className="frow__check" aria-hidden>{checked && <IconCheck width={10} height={10} />}</span>
      <span className="frow__name">{term.name}</span>
      <span className="frow__n">{term.count}</span>
    </button>
  );
}

type GNode = {
  id: number; label: string; hex: string; w: number | null; h: number | null;
  tags: string[];
  x: number; y: number;
};
type RawNode = Omit<GNode, "x" | "y">;
type GEdge = { source: number; target: number; score: number; kind: "similarity" | "tag" | "manual" };

/* ---- Card geometry ---- */
const CARD_W = 120;
const HEADER_H = 18;
const PORT_R = 3.5;
const CELL = 265; // field pitch: card + breathing room
const GRID_X = 160; // sorted-grid pitch: tight columns...
const GRID_Y = 245; // ...rows clear the tallest card (218px)

function cardOf(n: GNode): { w: number; h: number; bodyH: number } {
  const ar = n.w && n.h ? Math.max(0.6, Math.min(1.8, n.w / n.h)) : 1;
  const bodyH = CARD_W / ar;
  return { w: CARD_W, h: HEADER_H + bodyH, bodyH };
}
function portsOf(n: GNode, x: number, y: number) {
  const { w } = cardOf(n);
  return { lx: x - w / 2, rx: x + w / 2 };
}

const hash01 = (x: number) => {
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  return (((x >>> 16) ^ x) >>> 0) / 2 ** 32;
};

/* Ambient sway: paint-time only. */
const SWAY_W = 0.00026;
const SWAY_A = 2.6;
const swayX = (id: number, t: number) => Math.sin(t + id * 2.399963) * SWAY_A;
const swayY = (id: number, t: number) => Math.cos(t * 0.83 + id * 1.618) * SWAY_A;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function wireEnds(a: GNode, b: GNode, ax0: number, ay: number, bx0: number, by: number) {
  const dir = bx0 >= ax0 ? 1 : -1;
  const pa = portsOf(a, ax0, ay), pb = portsOf(b, bx0, by);
  return { ax: dir === 1 ? pa.rx : pa.lx, ay, bx: dir === 1 ? pb.lx : pb.rx, by, dir };
}

function wireDist(pxp: number, pyp: number, a: GNode, b: GNode) {
  const { ax, ay, bx, by, dir } = wireEnds(a, b, a.x, a.y, b.x, b.y);
  const k = Math.max(40, Math.abs(bx - ax) * 0.5);
  const c1x = ax + dir * k, c2x = bx - dir * k;
  let best = Infinity, lx = ax, ly = ay;
  for (let i = 1; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
    const y = u * u * u * ay + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * by;
    const d = segDist(pxp, pyp, lx, ly, x, y);
    if (d < best) best = d;
    lx = x; ly = y;
  }
  return best;
}

/** Centre-out square-spiral cell for pool index i. */
function spiralCell(i: number): { cx: number; cy: number } {
  if (i === 0) return { cx: 0, cy: 0 };
  let x = 0, y = 0, dx = 1, dy = 0, run = 1, step = 0, placed = 0;
  while (true) {
    for (let s = 0; s < run; s++) {
      x += dx; y += dy; placed++;
      if (placed === i) return { cx: x, cy: y };
    }
    // rotate right->down->left->up, run grows every two turns
    const nd = dx === 1 ? { dx: 0, dy: 1 } : dx === -1 ? { dx: 0, dy: -1 } : dy === 1 ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };
    dx = nd.dx; dy = nd.dy;
    step++;
    if (step % 2 === 0) run++;
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "rgba(127,127,127," + a + ")";
  const v = parseInt(m[1], 16);
  return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
}

/* the Curator's sort keys, computed from the Archivist's stored palette and
   keyterms — the hand-off between archetypes is shared data, not messages */

/** hex -> OKLCh-ish {L, C, h(deg)}: perceptual, cheap, good enough to sort by */
function oklch(hex: string): { L: number; C: number; h: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const lin = (u: number) => { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
  const r = lin((v >> 16) & 255), g = lin((v >> 8) & 255), b = lin(v & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const ss = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * ss;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * ss;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * ss;
  const C = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

const PERIOD_RANK = new Map(TAXONOMY.period.map((p, i) => [p, i]));
const WORK_RANK = new Map(TAXONOMY.work.map((w, i) => [w, i]));

function sortKey(n: { hex: string; tags: string[] }, mode: FieldSortMode): number {
  const c = oklch(n.hex);
  const L = c ? c.L : 0.5;
  if (mode === "light") return L;
  if (mode === "colour") {
    /* Perceptual, with a grey lane. 595 of the archive's 925 images are
       monochrome, and a grey pixel has no meaningful hue: sorting them onto
       a hue wheel ordered a third of the grid by noise. Greys now open the
       grid as their own dark-to-light band; chromatic images follow as
       twelve OKLCh hue bands, dark to light inside each. */
    if (!c || c.C < 0.03) return L * 9;                       // the grey lane
    return 10 + Math.floor(c.h / 30) * 10 + L * 9;            // the wheel
  }
  if (mode === "period") {
    /* decade bands top to bottom; undated sinks to the end as a worklist */
    for (const t of n.tags) { const r = PERIOD_RANK.get(t); if (r !== undefined) return r * 10 + L * 9; }
    return TAXONOMY.period.length * 10 + L * 9;
  }
  /* kind: work-type lanes in taxonomy order, dark-to-light inside each */
  for (const t of n.tags) { const r = WORK_RANK.get(t); if (r !== undefined) return r * 10 + L * 9; }
  return TAXONOMY.work.length * 10 + L * 9;
}

/* a folder name from the hunt that built the set: strip filler, title-case */
function folderNameFrom(q: string): string {
  const stop = new Set(["find", "show", "me", "images", "image", "of", "the", "a", "an", "some", "with", "that", "pull", "up", "give"]);
  const words = q.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter((w) => w && !stop.has(w)).slice(0, 3);
  if (!words.length) return "Selection";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/* a capability button's face: its verb, then its name and the archetype
   that owns it */
/* the archetype that owns a skill is stated by the group it sits under, not
   repeated beneath every button; a sub that says something else still shows */
const ARCH_NAMES = new Set(["archivist", "curator", "media manager", "atlas"]);

/* ---- the refine surface: an outside hunt's follow-up --------------------
   Checkable narrows (tones + a medium), a source to go deeper into — shown
   with the population it reported, so "go deeper" is a navigable fact — and
   a free line for the human's own words. Everything checked layers into ONE
   sentence that goes back through the agent as the next hunt. */
const REFINE_TONES = ["dark", "blue", "muted", "warm", "monochrome", "night"];
const REFINE_MEDIUMS = ["painting", "print", "photograph", "sculpture"];
const SOURCE_NAME: Record<string, string> = {
  met: "the Met", artic: "Art Institute", cleveland: "Cleveland",
  rijks: "Rijksmuseum", europeana: "Europeana", arena: "Are.na", pinterest: "Pinterest",
};
const fmtPop = (t: number) => "~" + t.toLocaleString("en-GB");

function RefineBlock({ item, busy, onGo }: {
  item: Extract<ThreadItem, { type: "refine" }>;
  busy: boolean;
  onGo: (text: string) => void;
}) {
  const [tones, setTones] = useState<string[]>([]);
  const [mediumPick, setMediumPick] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const spent = item.sent !== null;
  const chosen = tones.length > 0 || mediumPick !== null || source !== null || custom.trim().length > 0;

  const compose = () => {
    const narrow = [...tones, ...(mediumPick ? [mediumPick + "s only"] : [])];
    let s = "Refine the outside hunt for " + item.base;
    if (narrow.length) s += ": narrow to " + narrow.join(", ");
    if (custom.trim()) s += (narrow.length ? " — " : ": ") + custom.trim();
    if (source) s += ". Search only " + (SOURCE_NAME[source] ?? source) + ".";
    else if (!s.endsWith(".")) s += ".";
    return s;
  };

  if (spent && item.sent !== "-") {
    /* the refinement that went, kept as the block's receipt */
    return <div className="agent-refine is-spent"><span className="mono-label">refined</span><p>{item.sent}</p></div>;
  }
  return (
    <div className={"agent-refine" + (item.sent === "-" ? " is-passed" : "")}>
      <span className="mono-label">Refine the hunt</span>
      <div className="agent-refine__row">
        <span className="agent-refine__k">narrow to</span>
        {REFINE_TONES.map((t) => (
          <button
            key={t}
            className={"refine-chip" + (tones.includes(t) ? " is-on" : "")}
            aria-pressed={tones.includes(t)}
            disabled={spent || busy}
            onClick={() => setTones((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))}
          ><i />{t}</button>
        ))}
      </div>
      <div className="agent-refine__row">
        <span className="agent-refine__k">medium</span>
        {REFINE_MEDIUMS.map((mm) => (
          <button
            key={mm}
            className={"refine-chip" + (mediumPick === mm ? " is-on" : "")}
            aria-pressed={mediumPick === mm}
            disabled={spent || busy}
            onClick={() => setMediumPick((v) => (v === mm ? null : mm))}
          ><i />{mm}</button>
        ))}
      </div>
      <div className="agent-refine__row">
        <span className="agent-refine__k">only from</span>
        {item.sources.map((s) => (
          <button
            key={s.id}
            className={"refine-chip" + (source === s.id ? " is-on" : "")}
            aria-pressed={source === s.id}
            disabled={spent || busy}
            title={s.total != null ? fmtPop(s.total) + " matched there" : undefined}
            onClick={() => setSource((v) => (v === s.id ? null : s.id))}
          ><i />{SOURCE_NAME[s.id] ?? s.id}{s.total != null && <em>{fmtPop(s.total)}</em>}</button>
        ))}
      </div>
      <div className="agent-refine__go">
        <input
          value={custom}
          disabled={spent || busy}
          placeholder="or say it your way — smoky interiors, no portraits…"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && chosen && !busy) onGo(compose()); }}
          aria-label="Your own refinement"
        />
        <button className="agent-refine__send" disabled={spent || busy || !chosen} onClick={() => onGo(compose())}>
          go deeper
        </button>
      </div>
    </div>
  );
}

function CtaFace({ opt }: { opt: CtaOpt }) {
  const Icon = ctaIcon(opt.key);
  const sub = opt.sub && !ARCH_NAMES.has(opt.sub) ? opt.sub : null;
  return (
    <>
      {Icon && <span className="agent-cta__i"><Icon width={15} height={15} /></span>}
      <span className="agent-cta__t">
        <span className="agent-cta__l">{opt.label}</span>
        {sub && <span className="agent-cta__s">{sub}</span>}
      </span>
    </>
  );
}

/* outcome icons: one stroke weight, one grid — folder, folder-check, drive */
function OutIcon({ kind }: { kind: OutRow["icon"] }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "drive" ? (
        <>
          <rect x="1.5" y="6.5" width="13" height="6" rx="1.5" />
          <path d="M4 6.5 5.8 3h4.4L12 6.5" />
          <circle cx="11.6" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
        </>
      ) : kind === "check" ? (
        <path d="M3 8.5 6.5 12 13 4.5" />
      ) : (
        <>
          <path d="M1.5 5A1.5 1.5 0 0 1 3 3.5h3L7.5 5H13A1.5 1.5 0 0 1 14.5 6.5V11A1.5 1.5 0 0 1 13 12.5H3A1.5 1.5 0 0 1 1.5 11z" />
          {kind === "foldercheck" && <path d="M5.4 8.6 7.1 10.3 10.4 6.9" />}
        </>
      )}
    </svg>
  );
}

/** The tuning the page is server-rendered at. Shared, so the server and the first
 *  client render cannot disagree about which field was handed over. */
export const FIELD_DEFAULTS = { min: 0.82, mode: "blend" as const, edgesPerNode: 6 };

export default function GraphView({
  keyterms = [],
  initialGraph,
  readOnly = false,
}: {
  keyterms?: Keyterm[];
  /** The field, rendered on the server at FIELD_DEFAULTS. See app/page.tsx. */
  initialGraph?: { nodes: RawNode[]; edges: GEdge[] };
  /**
   * The hosted archive, where the middleware refuses every write and every
   * model call (see proxy.ts).
   *
   * Everything the FIELD does is client-side and still works: filtering,
   * sorting, releasing, panning, opening a card. What cannot work is anything
   * that leaves the browser. Knowing which is which up front is the whole
   * point of this flag: the alternative is a composer that invites a question
   * and answers it with a 403, which is what it used to do.
   */
  readOnly?: boolean;
}) {
  const dialogs = useDialogs();
  const router = useRouter();
  const initialNodeCount = initialGraph?.nodes.length ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [minScore, setMinScore] = useState(FIELD_DEFAULTS.min);
  const [simMode, setSimMode] = useState<"blend" | "structure" | "color" | "aesthetic">(FIELD_DEFAULTS.mode);
  const [cap, setCap] = useState(80);
  const [panel, setPanel] = useState<"search" | "prompt">("prompt");
  const [conversationCollapsed, setConversationCollapsed] = useState(false);
  const [promptIds, setPromptIds] = useState<number[] | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  /* the light table: outside finds on a TEMPORARY canvas docked to the
     panel's right edge, slid out from behind it. It opens DURING the turn —
     the moment the historian's row starts playing — and holds the images;
     the thread keeps only a one-line trace that can reopen it. */
  const [lightTable, setLightTable] = useState<{ query: string; items: Candidate[]; totals?: Record<string, number> } | null>(null);
  const [ltOpen, setLtOpen] = useState(false);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const toggleFilterTag = useCallback((name: string) => {
    setFilterTags((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }, []);
  const [searchQ, setSearchQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [openKind, setOpenKind] = useState<string | null>(null);
  /* a category with hundreds of terms (artist is 200+) needs a way in */
  const [termQ, setTermQ] = useState("");
  const TERM_SEARCH_AT = 12;
  const [simBusy, setSimBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile: the search/prompt bottom drawer
  const [filterSheetOpen, setFilterSheetOpen] = useState(false); // mobile: the filter drawer
  const [openFilterSec, setOpenFilterSec] = useState<string | null>(null); // one drawer section at a time

  const [fieldSort, setFieldSort] = useState<FieldSortMode | null>(null);
  /* the home panel introduces itself: Atlas thinks, speaks, then its
     capabilities arrive one after another */
  const [boot, setBoot] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  /* the field goes first. The panel holds back until the pictures have
     actually arrived on screen, then slides in; a fallback releases it so an
     empty library can never strand it. */
  const [panelIn, setPanelIn] = useState(false);
  /* the archive is ready to be LOOKED AT: cards spawned, thumbnails decoded,
     canvas real. This is what releases the preloader -- and nothing more, so
     that the opening below still has an audience when the cover lifts. */
  const [assetsReady, setAssetsReady] = useState(false);
  /* the cover is off and the opening can play */
  const [revealed, setRevealed] = useState(false);

  /* depend on WHETHER cards exist, never on how many: the count is rewritten
     every 120ms as the field spawns, and depending on it restarted the timer
     on every tick so it never finished */
  const hasCards = liveCount > 0;
  /** thumbnails that have actually decoded, counted by the draw loop's loaders */
  const paintedRef = useRef(0);
  useEffect(() => { reportAtlasBoot(25); }, []);
  /*
    Loading: the archive has PICTURES ready, not merely cards.

    This is what the preloader waits on, so it has to mean the thing behind
    the cover is genuinely worth uncovering -- the thumbnails have decoded,
    not just been asked for.

    Gated on a count rather than a delay, because the delay that looks right
    against a warm local cache is far too short on a cold deployment. The
    backstop covers the case that should not happen: images that never arrive
    must not cost the reader the archive.
  */
  useEffect(() => {
    if (assetsReady) return;
    if (!hasCards) {
      reportAtlasBoot(45);
      /* an empty library has nothing to decode and must not wait for it */
      const t = setTimeout(() => setAssetsReady(true), initialNodeCount === 0 ? 0 : 2200);
      return () => clearTimeout(t);
    }
    const enough = Math.max(1, Math.min(liveCount, 18));
    const started = performance.now();
    reportAtlasBoot(55);
    const id = setInterval(() => {
      const decoded = Math.min(paintedRef.current, enough);
      reportAtlasBoot(55 + (decoded / enough) * 39);
      if (paintedRef.current < enough && performance.now() - started < 5000) return;
      clearInterval(id);
      setAssetsReady(true);
    }, 100);
    return () => clearInterval(id);
  }, [assetsReady, hasCards, initialNodeCount]);

  /* The final signal is deliberately rendered-state based. Hydration alone is
     not enough: the canvas must have a real bitmap, the first cards must exist
     (unless the library is empty), and the fonts that determine the chrome
     geometry must be settled.

     It no longer waits for the composer. The composer is part of the opening,
     and the opening cannot play until this signal has taken the cover away --
     waiting for it here is what made the whole introduction happen in the
     dark. */
  useEffect(() => {
    if (!assetsReady) return;
    let cancelled = false;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    let firstFrame = 0;
    let secondFrame = 0;

    const verify = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const canvasReady = !!canvas && !!rect && rect.width > 0 && rect.height > 0
        && canvas.width > 0 && canvas.height > 0;
      const enough = Math.max(1, Math.min(liveCount, 18));
      const fieldReady = initialNodeCount === 0
        || (hasCards && paintedRef.current >= enough);
      if (canvasReady && fieldReady) {
        reportAtlasBoot(100, true);
        return;
      }
      verifyTimer = setTimeout(verify, 100);
    };

    reportAtlasBoot(96);
    void document.fonts.ready.catch(() => undefined).then(() => {
      if (cancelled) return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(verify);
      });
    });

    return () => {
      cancelled = true;
      if (verifyTimer) clearTimeout(verifyTimer);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [assetsReady, hasCards, initialNodeCount, liveCount]);

  /*
    Showing: the cover is off, so the opening can begin.

    Watched as an attribute rather than an event because four different paths
    end the boot -- the runtime's own exit, its 12s backstop, and the two
    fallbacks in AtlasPreloader when the runtime script never arrives at all.
    They agree on exactly one thing, which is this attribute. A session that
    has already booted starts "ready", so a revisit reveals from mount and
    behaves as it always did.
  */
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.atlasBoot === "ready") { setRevealed(true); return; }
    const obs = new MutationObserver(() => {
      if (root.dataset.atlasBoot !== "ready") return;
      obs.disconnect();
      setRevealed(true);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-atlas-boot"] });
    return () => obs.disconnect();
  }, []);

  /* The draw loop reads performance.now(), so the wave is stamped in the same
     clock it will be measured against. Asked for less motion, it is stamped
     already spent: the pictures are simply there, with no branch added to the
     per-card path to say so. */
  useEffect(() => {
    if (!revealed || sim.current.revealAt !== null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sim.current.revealAt = performance.now() - (still ? REVEAL_SPAN : 0);
  }, [revealed]);

  /*
    The panel arrives last, after the pictures it slides over.

    Letting it in while the field is still filling makes the opening read as
    one jumbled moment: a control to type into, over a picture still
    assembling. The order should be legible -- cards, then images, then the
    thing you type into -- so it waits out the picture wave and then takes a
    beat, which is what makes it read as its own move rather than the tail of
    the previous one.

    On a revisit there is no cover and the wave has long since run, so the
    remaining span is zero and only the beat is left.
  */
  useEffect(() => {
    if (panelIn || !revealed) return;
    const started = sim.current.revealAt;
    const waveLeft = started === null
      ? REVEAL_SPAN
      : Math.max(0, REVEAL_SPAN - (performance.now() - started));
    const t = setTimeout(() => setPanelIn(true), waveLeft + 420);
    return () => clearTimeout(t);
  }, [panelIn, revealed]);
  /* every step is reversible: a snapshot of the conversation before it, plus
     the action that produced it, so Back rewinds and Retry runs it again */
  const stepsRef = useRef<Step[]>([]);
  const [steps, setSteps] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const ledger = useRef<{ t: string; who: string; what: string }[]>([]);
  const pendingFolder = useRef<{ id: number; name: string } | null>(null);

  /* the grab thumb is REAL: drag a drawer down to dismiss it */
  const grabRef = useRef<{ startY: number; el: HTMLElement | null } | null>(null);
  function grabDown(e: React.PointerEvent) {
    const el = (e.currentTarget as HTMLElement).parentElement;
    grabRef.current = { startY: e.clientY, el };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (el) el.style.transition = "none";
  }
  function grabMove(e: React.PointerEvent) {
    const d = grabRef.current;
    if (!d?.el) return;
    const dy = Math.max(0, e.clientY - d.startY);
    d.el.style.transform = "translateY(" + dy + "px)";
  }
  function grabUp(e: React.PointerEvent, close: () => void) {
    const d = grabRef.current;
    grabRef.current = null;
    if (!d?.el) return;
    const el = d.el;
    const dy = Math.max(0, e.clientY - d.startY);
    el.style.transition = "";
    if (dy > 70) {
      close();
      requestAnimationFrame(() => { el.style.transform = ""; });
    } else {
      el.style.transform = "";
    }
  }
  /* Connections are OFF until asked for. The threads are the most active
     thing on a first landing and they pull the eye away from the images --
     and while the tagging is still being refined, what they assert is weaker
     than how loudly they assert it. The choice persists: someone who turns
     them on has said they want them, and should not have to say it again on
     every visit. Read in an effect, not the initializer, so the server and
     first client paint agree. */
  const [showWires, setShowWires] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem("atlas-wires") === "on") setShowWires(true); } catch { /* blocked storage */ }
  }, []);
  const setWires = (on: boolean) => {
    setShowWires(on);
    try { localStorage.setItem("atlas-wires", on ? "on" : "off"); } catch { /* blocked storage */ }
  };
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; title: string; desc: string | null } | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastQueryRef = useRef("");


  /* thinking (0) -> the greeting (1) -> the capabilities, in sequence (2) */
  const skipBootRef = useRef(false);
  /** the home block's own height, remembered so a drain can land ON it */
  const homeHRef = useRef(0);
  useEffect(() => {
    if (!panelIn || panel !== "prompt" || thread.length > 0) return;
    /* Straight to the finished state after a Clear. The intro is a
       first-impression sequence -- Atlas thinks, speaks, then its
       capabilities arrive -- and each stage makes the panel taller. Replayed
       after a drain it read as the window collapsing and then swelling back
       up over more than a second, which is not a greeting, it is a bounce.
       Seen once per visit is the point of it. */
    if (skipBootRef.current) {
      skipBootRef.current = false;
      setBoot(2);
      return;
    }
    setBoot(0);
    const a = setTimeout(() => setBoot(1), 900);
    const b = setTimeout(() => setBoot(2), 1320);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [panel, thread.length, panelIn]);

  /* Remember what the resting panel measures, while it is resting.

     Sampled to a settled value rather than read once: boot reaching 2 is
     the moment the capabilities START arriving, each on its own staggered
     reveal, so a single reading there caught the block half built -- 84px
     against a true 173 -- and floored the drain at less than half the
     right height. Keeping the largest reading over the following second
     lands on the finished size. */
  useEffect(() => {
    if (thread.length > 0 || boot < 2) return;
    let raf = 0;
    const until = performance.now() + 1200;
    const sample = () => {
      const sc = document.querySelector(".chatscroll") as HTMLElement | null;
      if (sc && !sc.style.minHeight) homeHRef.current = Math.max(homeHRef.current, sc.scrollHeight);
      if (performance.now() < until) raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf);
  }, [thread.length, boot]);

  /* the composer starts one line tall and grows only when the draft does
     (Shift+Enter adds lines), like the chatgpt field */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  /* the first thing asked becomes the conversation's TOPIC: the rail input
     locks read-only around it and titles the chat below */
  const topic = thread.find((m): m is Extract<ThreadItem, { type: "msg" }> => m.type === "msg" && m.role === "user")?.content ?? null;

  /* which items sit inside a turn: everything after a head, until the
     conversation returns to the user — their message, or choices offered
     to them. The reply is part of the block; the head names the speaker. */
  const nestedFlags = useMemo(() => {
    const flags: boolean[] = [];
    let inTurn = false;
    for (const x of thread) {
      if (x.type === "head") { inTurn = true; flags.push(false); continue; }
      if (x.type === "ctas" || x.type === "refine" || x.type === "skills" || x.type === "timeline" || (x.type === "msg" && x.role === "user")) inTurn = false;
      flags.push(inTurn);
    }
    return flags;
  }, [thread]);
  const headRunning = thread.some((x) => x.type === "head" && x.status === "running");

  /* the conversation keeps its newest message in view, like the analysis chat */
  useEffect(() => {
    if (!conversationCollapsed) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [thread, promptBusy, conversationCollapsed]);

  /* dropdowns close on outside click or Escape */
  useEffect(() => {
    if (!openKind) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".graph-catwrap")) setOpenKind(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      document.getElementById("graph-filter-trigger-" + openKind)?.focus();
      setOpenKind(null);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [openKind]);

  /* live search settles for a beat before the field re-pools, so typing
     does not thrash the spawn animations */
  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(searchQ.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchQ]);

  /* the narrowing box belongs to whichever category is open, not to the rail */
  useEffect(() => { setTermQ(""); }, [openKind, openFilterSec]);
  const narrowTerms = useCallback((items: Keyterm[]) => {
    const q = termQ.trim().toLowerCase();
    return q ? items.filter((t) => t.name.toLowerCase().includes(q)) : items;
  }, [termQ]);

  /* the keyterm vocabulary grouped the way the analysis writes it */
  const kinds = useMemo(() => {
    const groups = KIND_ORDER
      .map((k) => ({ kind: k as string, items: keyterms.filter((t) => t.kind === k) }))
      .filter((g) => g.items.length > 0);
    const known = new Set<string>(KIND_ORDER);
    const rest = keyterms.filter((t) => !known.has(t.kind));
    if (rest.length) groups.push({ kind: "tag", items: rest });
    return groups;
  }, [keyterms]);
  const [raw, setRaw] = useState<{ nodes: RawNode[]; edges: GEdge[] }>(
    initialGraph ?? { nodes: [], edges: [] }
  );
  const [tip, setTip] = useState<{ id: number; label: string; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [trail, setTrail] = useState<number[]>([]);
  const [collections, setCollections] = useState<{ id: number; name: string; depth: number }[]>([]);

  useEffect(() => {
    fetch("/api/collections").then((r) => r.json()).then((d) => setCollections(d.collections ?? [])).catch(() => {});
  }, []);

  /* the contextual door: a folder row's Save… arrives as ?save=<id> and
     drops straight into the same save flow the other three doors use */
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!collections.length) return;
    const c = collections.find((x) => x.id === Number(searchParams.get("save")));
    if (!c) return;
    router.replace("/", { scroll: false });
    setPanel("prompt");
    setSheetOpen(true);
    void dispatchCta("folder:" + c.id, c.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections, searchParams]);

  const sim = useRef<{
    nodes: GNode[]; edges: GEdge[]; byId: Map<number, GNode>;
    scale: number; ox: number; oy: number;
    dragging: GNode | null; panning: boolean; lastX: number; lastY: number;
    downX: number; downY: number;
    raf: number; images: Map<number, { lo?: HTMLImageElement; hi?: HTMLImageElement }>;
    hovered: GNode | null;
    hoveredEdge: GEdge | null;
    live: Map<number, { born: number; dying: number | null }>;
    wiring: { from: GNode; toX: number; toY: number } | null;
    /* when the opening wave started; null while the preloader still has the
       screen, after which every card holds its skeleton */
    revealAt: number | null;
  }>({
    nodes: [], edges: [], byId: new Map(),
    scale: 0.55, ox: 0, oy: 0,
    dragging: null, panning: false, lastX: 0, lastY: 0,
    downX: 0, downY: 0,
    raf: 0, images: new Map(),
    hovered: null,
    hoveredEdge: null,
    live: new Map(),
    wiring: null,
    revealAt: null,
  });

  const capRef = useRef(cap); capRef.current = cap;
  const showWiresRef = useRef(showWires); showWiresRef.current = showWires;
  const fieldSortRef = useRef<FieldSortMode | null>(null);

  // deep link: /?panel=prompt opens straight into prompt discovery
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("panel") === "prompt") setPanel("prompt");
  }, []);

  /* ---- data (metadata only; images stream per card) ----
     The effect ABORTS on cleanup: dev StrictMode mounts effects twice, and
     without the abort two identical fetches raced at load. The loser's
     setRaw landed ~0.5s after the field had spawned, rebuilt the pool, and
     the whole canvas visibly loaded twice. */
  const loadGraph = useCallback(async (signal?: AbortSignal) => {
    const d = await fetch("/api/graph?min=" + minScore + "&mode=" + simMode, { signal }).then((r) => r.json());
    setRaw({ nodes: d.nodes, edges: d.edges });
  }, [minScore, simMode]);
  /* What the server already handed over, so mounting does not immediately
     refetch a field that is already correct and rebuild the canvas under the
     reader. Anything the tune controls ask for beyond that is fetched as
     before. */
  const served = useRef(initialGraph ? FIELD_DEFAULTS.min + "|" + FIELD_DEFAULTS.mode : "");
  useEffect(() => {
    const want = minScore + "|" + simMode;
    if (served.current === want) return;
    const ac = new AbortController();
    loadGraph(ac.signal)
      .then(() => { served.current = want; })
      .catch(() => {});
    return () => ac.abort();
  }, [loadGraph, minScore, simMode]);

  /* ---- pool + homes: keyterm filter and prompt results narrow the pool;
     every pool image gets its fixed spiral home on the plane. Prompt matches
     are packed rank-first, so the best matches materialise at the centre. ---- */
  /* the search query narrows the pool ONLY in search mode — a leftover query
     must never silently intersect prompt results. Deriving the EFFECTIVE
     query (instead of depending on the mode itself) also means toggling
     Search/Prompt with no query never rebuilds the field. */
  const effectiveQ = panel === "search" ? appliedQ : "";

  useEffect(() => {
    const s = sim.current;
    let pool = filterTags.length
      ? raw.nodes.filter((n) => filterTags.every((t) => n.tags.includes(t)))
      : raw.nodes;
    const q = effectiveQ;
    if (q) {
      pool = pool.filter((n) =>
        n.label.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)));
    }
    if (promptIds) {
      const rank = new Map(promptIds.map((id, i) => [id, i]));
      pool = pool.filter((n) => rank.has(n.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }
    /* the Curator's sort: homes are handed out pool-order, so ordering the
       pool re-orders the whole layout */
    fieldSortRef.current = fieldSort;
    if (fieldSort) pool = [...pool].sort((a, b) => sortKey(a, fieldSort) - sortKey(b, fieldSort));

    const nodes: GNode[] = pool.map((n) => ({ ...n, x: 0, y: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = raw.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

    if (fieldSort) {
      /* a sorted field reads as a GRID: row-major, top to bottom, no jitter */
      const cols = Math.max(4, Math.ceil(Math.sqrt(nodes.length * 1.5)));
      const rows = Math.ceil(nodes.length / cols);
      nodes.forEach((n, i) => {
        n.x = ((i % cols) - (cols - 1) / 2) * GRID_X;
        n.y = (Math.floor(i / cols) - (rows - 1) / 2) * GRID_Y;
      });
    } else {
      nodes.forEach((n, i) => {
        const { cx, cy } = spiralCell(i);
        n.x = cx * CELL + (hash01(n.id * 3 + 1) - 0.5) * 110;
        n.y = cy * CELL + (hash01(n.id * 5 + 2) - 0.5) * 110;
      });
    }

    s.nodes = nodes;
    s.byId = byId;
    s.edges = edges;
    s.live = new Map();
    s.hovered = null;
  }, [raw, filterTags, promptIds, effectiveQ, fieldSort]);

  /* recentre camera when the arrangement itself changes */
  useEffect(() => {
    const s = sim.current;
    s.ox = 0; s.oy = 0;
    s.scale = 0.55;
    if (fieldSort) {
      /* a top-to-bottom grid greets you at its top row, not its middle
         (the pool effect above has already laid out s.nodes) */
      const n = s.nodes.length;
      const cols = Math.max(4, Math.ceil(Math.sqrt(n * 1.5)));
      const rows = Math.ceil(n / cols);
      const topY = -((rows - 1) / 2) * GRID_Y;
      const h = wrapRef.current?.clientHeight ?? 800;
      s.oy = 140 - h / 2 - topY * s.scale;
    }
  }, [filterTags, promptIds, effectiveQ, fieldSort]);

  /* ---- render loop: spawn management + paint ---- */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = sim.current;

    const fitCanvas = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      if (r.width > 0 && r.height > 0 && canvas.width > 0 && canvas.height > 0) {
        reportAtlasBoot(40);
      }
    };
    fitCanvas();
    const ro = new ResizeObserver(fitCanvas);
    ro.observe(wrap);

    const css = getComputedStyle(document.documentElement);
    const colAccent = () =>
      css.getPropertyValue("--accent").trim() ||
      css.getPropertyValue("--text-primary").trim() ||
      "#ffffff";
    const colBg = () => css.getPropertyValue("--bg").trim() || "#020202";
    const colSurface = () => css.getPropertyValue("--surface").trim() || "#0d0d0d";
    const colStrong = () => css.getPropertyValue("--border-strong").trim() || "#555";
    const colMuted = () => css.getPropertyValue("--text-muted").trim() || "#7b7b7b";
    const colLine = () => css.getPropertyValue("--network-line").trim() || "#c0c0c0";

    let lastLiveSync = 0;

    function step() {
      const nowT = performance.now();
      const W = canvas.width, H = canvas.height;

      // visible world rect
      const vw = W / devicePixelRatio / s.scale, vh = H / devicePixelRatio / s.scale;
      const vx0 = (-W / 2 / devicePixelRatio - s.ox) / s.scale;
      const vy0 = (-H / 2 / devicePixelRatio - s.oy) / s.scale;
      const vx1 = vx0 + vw, vy1 = vy0 + vh;
      const margin = CARD_W * 1.6;

      /* ---- Spawn management (throttled): cards inside the viewport come
         alive nearest-centre-first until the cap; cards that left the ground
         fade out and free their slot. ---- */
      if (nowT - lastLiveSync > 120) {
        lastLiveSync = nowT;
        const cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
        const inView: { n: GNode; d: number }[] = [];
        for (const n of s.nodes) {
          if (n.x > vx0 - margin && n.x < vx1 + margin && n.y > vy0 - margin && n.y < vy1 + margin) {
            inView.push({ n, d: (n.x - cx) ** 2 + (n.y - cy) ** 2 });
          }
        }
        inView.sort((a, b) => a.d - b.d);

        /* Zoom-aware budget: cards on a zoomed-out canvas cover few pixels,
           so the live cap scales with 1/scale^2 and the view FILLS instead of
           floating a handful of cards on black. Spawns are metered per tick,
           so a zoom-out or a fast pan streams cards in waves rather than
           decoding hundreds of thumbnails in one frame. */
        const zoomBoost = Math.max(1, (0.55 / s.scale) ** 2);
        const effCap = Math.min(s.nodes.length, Math.round(capRef.current * zoomBoost));

        const inViewIds = new Set(inView.map((v) => v.n.id));
        for (const [id, st] of s.live) {
          if (!inViewIds.has(id) && !st.dying) st.dying = nowT;
        }
        let alive = 0;
        for (const st of s.live.values()) if (!st.dying) alive++;
        let spawned = 0;
        for (const { n } of inView) {
          if (alive >= effCap || spawned >= 60) break;
          const st = s.live.get(n.id);
          if (!st) { s.live.set(n.id, { born: nowT, dying: null }); alive++; spawned++; }
          else if (st.dying) { st.dying = null; alive++; }
        }
        for (const [id, st] of s.live) {
          if (st.dying && nowT - st.dying > 300) s.live.delete(id);
        }
        setLiveCount(alive);
      }

      /* ---- Paint ---- */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = colBg();
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(
        s.scale * devicePixelRatio, 0, 0, s.scale * devicePixelRatio,
        (W / 2 + s.ox * devicePixelRatio), (H / 2 + s.oy * devicePixelRatio),
      );

      const tS = nowT * SWAY_W;
      const px = (n: GNode) => n === s.dragging ? n.x : n.x + swayX(n.id, tS);
      const py = (n: GNode) => n === s.dragging ? n.y : n.y + swayY(n.id, tS);
      const fadeOf = (id: number) => {
        const st = s.live.get(id);
        if (!st) return 0;
        if (st.dying) return Math.max(0, 1 - (nowT - st.dying) / 300);
        return easeOut(Math.min(1, (nowT - st.born) / 300));
      };

      const accent = colAccent();
      const surface = colSurface();
      const strong = colStrong();
      const muted = colMuted();
      const lineCol = colLine();

      /* Wires between live cards: ONE quiet language. Every established
         connection is the same thin thread in the network-line colour;
         what KIND of connection it is lives in the diptych, not the paint. */
      if (showWiresRef.current && !fieldSortRef.current) for (const e of s.edges) {
        const fa = fadeOf(e.source), fb = fadeOf(e.target);
        if (fa <= 0 || fb <= 0) continue;
        const a = s.byId.get(e.source)!, b = s.byId.get(e.target)!;
        const { ax, ay, bx, by, dir } = wireEnds(a, b, px(a), py(a), px(b), py(b));
        const k = Math.max(40, Math.abs(bx - ax) * 0.5);
        const isHover = e === s.hoveredEdge;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(ax + dir * k, ay, bx - dir * k, by, bx, by);
        /* the wire under the cursor answers in the active interaction color */
        ctx.lineWidth = (isHover ? 1.8 : 1) / Math.max(0.6, s.scale);
        ctx.strokeStyle = isHover ? accent : lineCol;
        ctx.globalAlpha = isHover ? 0.95 : (0.3 + e.score * 0.3) * Math.min(fa, fb);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1 / Math.max(0.6, s.scale);

      /* Live connection wire: dotted circles walking the curve while a
         connection is being drawn; it solidifies into a line on drop. */
      if (s.wiring) {
        const f = s.wiring.from;
        const fx0 = px(f), fy0 = py(f);
        const dir = s.wiring.toX >= fx0 ? 1 : -1;
        const p = portsOf(f, fx0, fy0);
        const ax = dir === 1 ? p.rx : p.lx;
        const bx = s.wiring.toX, by = s.wiring.toY;
        const k = Math.max(40, Math.abs(bx - ax) * 0.5);
        const c1x = ax + dir * k, c2x = bx - dir * k;
        const dotR = 2.2 / Math.max(0.55, Math.min(1.2, s.scale));
        const spacing = 15;
        ctx.fillStyle = lineCol;
        ctx.globalAlpha = 0.9;
        let prevX = ax, prevY = fy0, acc = 0;
        for (let i = 1; i <= 60; i++) {
          const t = i / 60, u = 1 - t;
          const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
          const y = u * u * u * fy0 + 3 * u * u * t * fy0 + 3 * u * t * t * by + t * t * t * by;
          acc += Math.hypot(x - prevX, y - prevY);
          if (acc >= spacing) {
            ctx.beginPath();
            ctx.arc(x, y, dotR, 0, Math.PI * 2);
            ctx.fill();
            acc = 0;
          }
          prevX = x; prevY = y;
        }
        ctx.globalAlpha = 1;
      }

      /* Cards */
      const showText = s.scale >= 0.42;
      if (showText) ctx.font = '9px "Input Mono", ui-monospace, monospace';

      /* The opening wave, measured from the middle of the view. Negative
         means the cover is still up and nothing has crossed over yet; past
         REVEAL_SPAN it is spent, and cards spawned later by panning behave
         as they always have -- skeleton while streaming, picture once
         decoded. The distance is taken in screen pixels so the wave moves at
         the speed the eye sees it, whatever the zoom. */
      const revealT = s.revealAt === null ? -1 : nowT - s.revealAt;
      const waving = revealT >= 0 && revealT < REVEAL_SPAN;
      const viewCx = -s.ox / s.scale, viewCy = -s.oy / s.scale;

      for (const [id] of s.live) {
        const n = s.byId.get(id);
        if (!n) continue;
        const fade = fadeOf(id);
        if (fade <= 0) continue;
        const nx = px(n), ny = py(n);
        const { w, h, bodyH } = cardOf(n);
        const grow = 0.86 + 0.14 * fade; // hologram spawn: scale + fade in
        const cw = w * grow, ch = h * grow;
        const left = nx - cw / 2, top = ny - ch / 2;
        const rr = 5;

        ctx.globalAlpha = fade;

        ctx.beginPath();
        ctx.roundRect(left, top, cw, ch, rr);
        ctx.fillStyle = surface;
        ctx.fill();

        if (showText && fade > 0.6) {
          ctx.fillStyle = muted;
          const label = n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label;
          ctx.fillText(label.toUpperCase(), left + 7, top + 12.5, cw - 14);
        }

        /* Two resolution tiers: 128px thumbs for the far field, 320px once
           zoomed in. The low tier keeps a fully filled zoomed-out canvas
           light on memory; the high tier swaps in seamlessly on approach. */
        let entry = s.images.get(n.id);
        if (!entry) { entry = {}; s.images.set(n.id, entry); }
        const wantHi = s.scale >= 0.8;
        /* onload counts, so something outside the draw loop can tell how much of
           the field is pictures rather than skeletons. Only the first tier a
           card asks for is counted: a hi swapping in behind a lo is a
           refinement, not another card arriving. */
        if (wantHi && !entry.hi) {
          entry.hi = new Image();
          if (!entry.lo) entry.hi.onload = () => { paintedRef.current += 1; };
          entry.hi.src = "/api/img/" + n.id + "?s=320";
        }
        if (!wantHi && !entry.lo && !entry.hi) {
          entry.lo = new Image();
          entry.lo.onload = () => { paintedRef.current += 1; };
          entry.lo.src = "/api/img/" + n.id + "?s=128";
        }
        const hiOk = entry.hi?.complete && entry.hi.naturalWidth;
        const loOk = entry.lo?.complete && entry.lo.naturalWidth;
        const im = (wantHi && hiOk) ? entry.hi! : loOk ? entry.lo! : hiOk ? entry.hi! : null;

        /* how much of this card's picture the wave has uncovered */
        let shown = 1;
        if (revealT < 0) shown = 0;
        else if (waving) {
          const d = Math.hypot(nx - viewCx, ny - viewCy) * s.scale;
          const wait = Math.min(REVEAL_LEAD, d * REVEAL_SPREAD);
          shown = Math.max(0, Math.min(1, (revealT - wait) / REVEAL_FADE));
        }

        const bodyTop = top + HEADER_H * grow;
        const bw = cw - 2, bh = ch - HEADER_H * grow - 1;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(left + 1, bodyTop, bw, bh, [0, 0, rr - 1, rr - 1]);
        ctx.clip();
        /* Skeleton first, and it stays under a picture that is still crossing
           in: dominant-colour tint + a shimmer band sweeping across, drawn
           while the thumbnail streams -- or, during the opening, while a
           thumbnail that decoded behind the cover waits its turn. */
        if (!im || shown < 1) {
          ctx.fillStyle = hexA(n.hex, 0.16);
          ctx.fillRect(left + 1, bodyTop, bw, bh);
          const sweep = ((nowT / 850 + n.id * 0.161) % 1) * (bw + 120) - 60;
          const gx = left + 1 + sweep;
          const shine = ctx.createLinearGradient(gx - 55, 0, gx + 55, 0);
          shine.addColorStop(0, "rgba(160,160,160,0)");
          shine.addColorStop(0.5, "rgba(160,160,160,0.16)");
          shine.addColorStop(1, "rgba(160,160,160,0)");
          ctx.fillStyle = shine;
          ctx.fillRect(left + 1, bodyTop, bw, bh);
        }
        if (im && shown > 0) {
          const ir = im.naturalWidth / im.naturalHeight, br = bw / bh;
          let dw = bw, dh = bh, dx = left + 1, dy = bodyTop;
          if (ir > br) { dw = bh * ir; dx -= (dw - bw) / 2; }
          else { dh = bw / ir; dy -= (dh - bh) / 2; }
          if (shown < 1) ctx.globalAlpha = fade * shown;
          ctx.drawImage(im, dx, dy, dw, dh);
          if (shown < 1) ctx.globalAlpha = fade;
        }
        ctx.restore();

        ctx.beginPath();
        ctx.roundRect(left, top, cw, ch, rr);
        if (n === s.hovered || n === s.wiring?.from) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.4 / Math.max(0.5, s.scale);
        } else {
          ctx.strokeStyle = strong;
          ctx.lineWidth = 1.1 / Math.max(0.5, s.scale);
        }
        ctx.stroke();

        /* connections off = clean images: no side ports either */
        if (showWiresRef.current && !fieldSortRef.current) {
          const pr = PORT_R / Math.max(0.55, Math.min(1, s.scale));
          for (const sideX of [left, left + cw]) {
            ctx.beginPath();
            ctx.arc(sideX, ny, pr, 0, Math.PI * 2);
            ctx.fillStyle = surface;
            ctx.fill();
            ctx.strokeStyle = n === s.hovered ? accent : strong;
            ctx.lineWidth = 1.4 / Math.max(0.5, s.scale);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      s.raf = requestAnimationFrame(step);
    }
    s.raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(s.raf); ro.disconnect(); };
  }, []);

  /* ---- interaction (live cards only) ---- */
  const toWorld = useCallback((cx: number, cy: number) => {
    const s = sim.current;
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (cx - r.left - r.width / 2 - s.ox) / s.scale,
      y: (cy - r.top - r.height / 2 - s.oy) / s.scale,
    };
  }, []);

  const liveNodes = useCallback((): GNode[] => {
    const s = sim.current;
    const out: GNode[] = [];
    for (const [id, st] of s.live) {
      if (st.dying) continue;
      const n = s.byId.get(id);
      if (n) out.push(n);
    }
    return out;
  }, []);

  const pick = useCallback((cx: number, cy: number): GNode | null => {
    const s = sim.current;
    const w = toWorld(cx, cy);
    const tS = performance.now() * SWAY_W;
    const pad = 4 / s.scale;
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of liveNodes()) {
      const card = cardOf(n);
      const nx = n.x + swayX(n.id, tS), ny = n.y + swayY(n.id, tS);
      if (Math.abs(w.x - nx) <= card.w / 2 + pad && Math.abs(w.y - ny) <= card.h / 2 + pad) {
        const d = (nx - w.x) ** 2 + (ny - w.y) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    return best;
  }, [toWorld, liveNodes]);

  const pickPort = useCallback((cx: number, cy: number): GNode | null => {
    if (!showWiresRef.current || fieldSortRef.current) return null; // no ports while connections are off or a grid is up
    const s = sim.current;
    const w = toWorld(cx, cy);
    const tS = performance.now() * SWAY_W;
    const hit = Math.max(8, 10 / s.scale);
    for (const n of liveNodes()) {
      const nx = n.x + swayX(n.id, tS), ny = n.y + swayY(n.id, tS);
      const p = portsOf(n, nx, ny);
      if (Math.hypot(w.x - p.lx, w.y - ny) < hit || Math.hypot(w.x - p.rx, w.y - ny) < hit) return n;
    }
    return null;
  }, [toWorld, liveNodes]);

  const pickEdge = useCallback((cx: number, cy: number) => {
    const s = sim.current;
    const w = toWorld(cx, cy);
    const thresh = 10 / s.scale;
    let best: GEdge | null = null;
    let bestD = thresh;
    for (const e of s.edges) {
      const la = s.live.get(e.source), lb = s.live.get(e.target);
      if (!la || la.dying || !lb || lb.dying) continue;
      const a = s.byId.get(e.source), b = s.byId.get(e.target);
      if (!a || !b) continue;
      const d = wireDist(w.x, w.y, a, b);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }, [toWorld]);

  /* messages only (the model never sees tool rows or proposals as history) */
  const historyOf = (items: ThreadItem[]): ChatMsg[] =>
    items.filter((i): i is Extract<ThreadItem, { type: "msg" }> => i.type === "msg")
      .map((i) => ({ role: i.role, content: i.content }));

  const fmtDetail = (tool: string, args: Record<string, unknown>): string => {
    if (tool === "search_library") return "“" + String(args.query ?? "") + "”";
    if (tool === "filter_by_terms") return (Array.isArray(args.terms) ? args.terms.join(", ") : "");
    if (tool === "propose_folder") return "“" + String(args.name ?? "") + "”";
    if (tool === "sort_field") return String(args.by ?? "");
    if (tool === "search_outside") {
      return "“" + String(args.query ?? "") + "”"
        + (args.medium ? " · " + String(args.medium) + "s" : "")
        + (args.source ? " · " + String(args.source) : "");
    }
    return "";
  };
  const fmtResult = (raw: string): string => {
    try {
      const r = JSON.parse(raw);
      if (r.staged) return "staged · " + r.count;
      if (r.sorted) return r.sorted === "off" ? "grid dropped" : "grid re-formed";
      if (r.shown != null) return "field re-formed · " + r.shown;
      /* search_outside: found/keepable, checked before the generic count.
         total_matched is the POPULATION the sources reported — when it
         exists, the row says both, so a capped preview never reads as
         everything there is. */
      if (r.found != null) {
        const of = typeof r.total_matched === "number" && r.total_matched > r.found
          ? " of ~" + Number(r.total_matched).toLocaleString("en-GB")
          : "";
        return r.found + of + " outside · " + (r.keepable ?? 0) + " keepable";
      }
      if (r.count != null) return r.count + " in set";
      if (r.released) return "field released";
    } catch { /* opaque */ }
    return "done";
  };

  /* The turn's head: ATLAS appears in the thread and narrates; whatever
     follows until the conversation returns to the user nests beneath it.
     One head per stretch of work — a user interjection (Accept) closes the
     block and the next work opens a new one, so the chat order stays honest. */
  function pushHead(what: string) {
    setThread((it) => [...it, { type: "head", what, status: "running" }]);
  }
  /* both walk back to the LAST head and touch it only while it still runs */
  function retitleHead(what: string) {
    setThread((it) => {
      for (let k = it.length - 1; k >= 0; k--) {
        const x = it[k];
        if (x.type !== "head") continue;
        if (x.status !== "running") break;
        return it.map((y, j) => (j === k && y.type === "head" ? { ...y, what } : y));
      }
      return it;
    });
  }
  function closeHead(what: string) {
    setThread((it) => {
      for (let k = it.length - 1; k >= 0; k--) {
        const x = it[k];
        if (x.type !== "head") continue;
        if (x.status !== "running") break;
        return it.map((y, j) => (j === k && y.type === "head" ? { ...y, what, status: "done" as const } : y));
      }
      return it;
    });
  }

  /* a tool row lives on screen: it appears RUNNING with the lens's ident
     working, holds ~2s so the work is visible, then resolves into the pixel
     check. The head narrates whatever the row is doing. */
  async function playToolRow(tool: string, detail: string, result: string, holdMs = 2000) {
    const meta = TOOL_META[tool];
    if (meta) retitleHead(meta.task);
    let index = -1;
    setThread((it) => {
      index = it.length;
      return [...it, { type: "tool", tool, detail, result, status: "running" }];
    });
    await new Promise((r) => setTimeout(r, holdMs));
    setThread((it) => it.map((x, i) => (i === index && x.type === "tool" ? { ...x, status: "done" as const } : x)));
    await new Promise((r) => setTimeout(r, 420)); // the check resolves before the next row
  }

  function atlasEnabled(): boolean {
    try {
      const v = JSON.parse(localStorage.getItem("atlas-agents-enabled") || "{}");
      return v.atlas !== false && v.discovery !== false && v.curator !== false;
    } catch { return true; }
  }

  /* The Historian's switch travels WITH the request: the server drops the
     outside-search tool for a turn that says false, so switching the lens off
     in Agents genuinely retires the capability rather than hiding a button. */
  function historianEnabled(): boolean {
    try {
      const v = JSON.parse(localStorage.getItem("atlas-agents-enabled") || "{}");
      return v.historian !== false;
    } catch { return true; }
  }

  /** every id currently forming the field, in the order it is laid out */
  function fieldIds(): number[] {
    return sim.current.nodes.map((n) => n.id);
  }
  /* Above this the client CONFIRMS before writing. The server keeps its own
     higher ceiling in /api/export; this number is only where asking starts. */
  const DISK_CAP = 400;

  /* the session ledger: everything Atlas does, everything you decide */
  function logLedger(who: string, what: string) {
    const d = new Date();
    ledger.current.push({ t: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), who, what });
  }
  function pushStep(action: Action) {
    stepsRef.current.push({ thread, promptIds, fieldSort, action });
    setSteps(stepsRef.current.length);
  }
  function restore(st: Step) {
    setThread(st.thread);
    setPromptIds(st.promptIds);
    setFieldSort(st.fieldSort);
    setSteps(stepsRef.current.length);
  }
  /** undo ONE exchange: the last response and its change to the canvas go,
      everything before stays. Files already written to disk stay written. */
  function undoLast() {
    const st = stepsRef.current.pop();
    if (st) restore(st);
  }
  async function copyReply(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400);
    } catch { /* clipboard blocked */ }
  }

  const pushAtlas = (content: string) => setThread((t) => [...t, { type: "msg", role: "assistant", content }]);
  /*
    Every action that writes, in one place.

    The hosted archive refuses all of them at the middleware, so offering one
    is offering a dead end: the reader picks "Save a folder", answers two more
    questions, and only then finds out nothing here can be written. Filtering
    centrally rather than at each call site means a follow-up set added later
    cannot reintroduce the dead end by forgetting.
  */
  const WRITES = new Set([
    "tag", "dedupe", "dedupe-go",
    "save", "save-new", "save-existing", "save-local", "save-atlas", "save-disk", "save-both",
    "post-save",
  ]);
  const pushCtas = (options: CtaOpt[]) =>
    setThread((t) => [
      ...t,
      {
        type: "ctas",
        options: readOnly ? options.filter((o) => !WRITES.has(o.key) && !o.key.startsWith("into:")) : options,
        picked: null,
      },
    ]);
  const pushOutcome = (rows: OutRow[]) => setThread((t) => [...t, { type: "outcome", rows }]);
  /* a finished task never dead-ends: Atlas hands back the moves that make
     sense from where the conversation now stands, plus a way to the full
     menu. Called at the END of a flow, never mid-question. */
  function pushNext(keys: string[]) {
    pushCtas([...keys.map((k) => CTA_META[k]).filter(Boolean), CTA_META.skills]);
  }

  const retireCtas = () => setThread((it) => it.map((x) =>
    x.type === "ctas" && !x.picked ? { ...x, picked: "-" }
    : x.type === "refine" && x.sent === null ? { ...x, sent: "-" }
    : x));

  function onCta(index: number, key: string, label: string) {
    setThread((it) => it.map((x, i) => (i === index && x.type === "ctas" ? { ...x, picked: key } : x)));
    void dispatchCta(key, label);
  }

  /* ---- the archetype flows. Conversation, home CTAs, the "/" palette and
     contextual triggers all dispatch here ---- */
  async function dispatchCta(key: string, label: string) {
    pushStep({ kind: "cta", key, label });
    setThread((t) => [...t, { type: "msg", role: "user", content: label }]);
    retireCtas();
    if (!atlasEnabled()) { pushAtlas("Atlas is switched off. Turn it on under Agents in the sidebar and I can act again."); return; }

    if (key === "find") {
      pushAtlas("Describe it: a mood, a subject, a line of text, an artist. I hunt with the library's own tools and re-form the field around what holds. You can also hand me an image with +.");
      composerRef.current?.focus();
      return;
    }

    if (key === "tag") {
      try {
        const d = await fetch("/api/list").then((r) => r.json());
        const total = Number(d.total ?? 0);
        const untagged = Math.max(0, total - raw.nodes.length);
        if (untagged) {
          pushAtlas(untagged + " of " + total + " images are not on the field yet: no keyterms. Today the Archivist tags through the Analyze studio; the overnight pass is the next build. Want to go there?");
          pushCtas([{ key: "go-analyze", label: "Open the Analyze studio", sub: "archivist" }, { key: "home", label: "Not now" }]);
        } else {
          pushAtlas("Every image already carries keyterms. The field is fully tagged.");
          pushNext(["sort", "find", "save"]);
        }
      } catch {
        pushAtlas("Could not count the untagged just now. The Analyze studio is in the sidebar.");
      }
      return;
    }
    if (key === "go-analyze") { router.push("/analyze"); return; }
    if (key === "home" || key === "skills") {
      setThread((t) => [...t, { type: "skills" }]);
      return;
    }

    if (key === "sort") {
      const scope = poolSize === raw.nodes.length ? "all " + poolSize + " cards" : "just the " + poolSize + " cards showing now";
      pushAtlas("I sort whatever the field is showing: right now that is " + scope + ", laid out as a grid you read top to bottom.");
      pushCtas([
        { key: "sort-colour", label: "By colour", sub: "greys, then the wheel" },
        { key: "sort-light", label: "By light", sub: "dark → bright" },
        { key: "sort-period", label: "By period", sub: "decade bands" },
        { key: "sort-kind", label: "By kind", sub: "work-type lanes" },
        { key: "sort-off", label: "Release", sub: "original order" },
      ]);
      return;
    }
    if (key === "sort-colour" || key === "sort-light" || key === "sort-period" || key === "sort-kind") {
      const mode = key.slice(5) as FieldSortMode;
      await playToolRow("sort_field", mode, "field re-formed");
      setFieldSort(mode);
      logLedger("curator", "sorted the field by " + mode);
      pushAtlas(mode === "colour"
        ? "Done. A grid, top to bottom: the greys first, dark to light, then the hue wheel sweeps the rows."
        : mode === "light"
        ? "Done. A grid, top to bottom: dark at the top, bright at the bottom."
        : mode === "period"
        ? "Done. A grid in decade bands, earliest at the top; the undated gather at the end."
        : "Done. A grid in work-type lanes: photographs, posters, spreads, screens, each kind together.");
      pushNext(["save", "find", "post-release"]);
      return;
    }
    if (key === "sort-off") {
      setFieldSort(null);
      logLedger("curator", "released the sort");
      pushAtlas("Released. Every card is back at its spiral home.");
      pushNext(["sort", "find", "save"]);
      return;
    }

    if (key === "save") {
      const n = promptIds?.length ?? poolSize;
      pushAtlas("There are " + n + " images on the field. I can file them somewhere new, add them to a folder you already have, or mirror a folder to real files on your disk.");
      pushCtas([CTA_META["save-new"], CTA_META["save-existing"], CTA_META["save-local"], CTA_META.skills]);
      return;
    }

    /* a new folder: named by you, staged as a proposal, written only on accept */
    if (key === "save-new") {
      const ids = fieldIds();
      if (!ids.length) {
        pushAtlas("There is nothing on the field to file. Find or filter something first and I will file exactly what is showing.");
        pushNext(["find", "filter"]);
        return;
      }
      const name = await dialogs.prompt({
        title: "New folder",
        message: "Atlas stages it as a proposal. Nothing is written until you accept.",
        label: "Name",
        placeholder: "e.g. Solitude",
        confirmLabel: "Stage it",
      });
      if (!name) { pushAtlas("Left it alone."); pushNext(["save", "find"]); return; }
      setThread((t) => [...t, { type: "proposal", name: name.slice(0, 60), note: "A new folder for what is on the field.", ids, status: "pending" }]);
      logLedger("media manager", "proposed “" + name + "” · " + ids.length + " images");
      return;
    }

    /* an existing folder: the same staged write, aimed at a name that exists */
    if (key === "save-existing") {
      if (!collections.length) { pushAtlas("You have no folders yet. Create one first."); pushNext(["save-new"]); return; }
      const ids = fieldIds();
      if (!ids.length) {
        pushAtlas("There is nothing on the field to add. Find or filter something first and I will add exactly what is showing.");
        pushNext(["find", "filter"]);
        return;
      }
      pushAtlas("Which folder should these " + ids.length + " join?");
      pushCtas([...collections.slice(0, 6).map((c) => ({ key: "into:" + c.id, label: c.name, sub: "folder" })), CTA_META.skills]);
      return;
    }
    if (key.startsWith("into:")) {
      const c = collections.find((x) => x.id === Number(key.slice(5)));
      const ids = fieldIds();
      if (!c || !ids.length) return;
      setThread((t) => [...t, { type: "proposal", name: c.name, note: "Adding to the folder you already have.", ids, status: "pending" }]);
      logLedger("media manager", "proposed " + ids.length + " into “" + c.name + "”");
      return;
    }

    /* the disk: real files under ~/Atlas Exports, copies only */
    if (key === "save-local") {
      const onField = fieldIds();
      pushAtlas("Which images should become real files? You pick where they land, and the originals are never touched.");
      pushCtas([
        ...(onField.length ? [{ key: "disk:field", label: "What is on the canvas", sub: onField.length + " images" }] : []),
        ...collections.slice(0, 6).map((c) => ({ key: "disk:" + c.id, label: c.name, sub: "folder" })),
        CTA_META.skills,
      ]);
      return;
    }
    if (key.startsWith("disk:")) {
      const isField = key === "disk:field";
      const c = isField ? null : collections.find((x) => x.id === Number(key.slice(5)));
      if (!isField && !c) return;
      const source: { collectionId?: number; ids?: number[]; name?: string } =
        isField ? { ids: fieldIds(), name: "Canvas" } : { collectionId: c!.id };
      const sourceName = isField ? "the canvas" : c!.name;
      if (isField) {
        const n = source.ids?.length ?? 0;
        if (!n) { pushAtlas("There is nothing on the canvas to save."); return; }
        /* The cap is there so one tap cannot ship the whole archive by
           accident. Accidents are answered by ASKING, not by refusing: a
           narrowed field of 450 is a deliberate choice, and a wall in front of
           it is the tool arguing with a decision the human already made. */
        if (n > DISK_CAP) {
          const go = await dialogs.confirm({
            title: "Write " + n + " files?",
            message:
              "That is a large save: " + n + " copies under the folder you pick. Originals in the library are never touched, and nothing in the archive changes.",
            confirmLabel: "Write them",
          });
          if (!go) {
            pushAtlas("Left it alone. Narrow the field and ask again if you want fewer.");
            pushNext(["find", "filter", "save-local"]);
            return;
          }
        }
      }
      /* the native dialog first: save anywhere on the machine. The picker
         must open inside the click's user activation, before any fetch. */
      const picker = (window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (picker) {
        let dir: FileSystemDirectoryHandle;
        try {
          dir = await picker.call(window, { mode: "readwrite" });
        } catch {
          pushAtlas("Left it alone.");
          pushNext(["save-local", "find"]);
          return;
        }
        try {
          const d = await fetch("/api/export", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...source, list: true }),
          }).then((r) => r.json());
          if (!Array.isArray(d.files)) throw new Error(d.error || "listing failed");
          let written = 0;
          for (const f of d.files as { id: number; filename: string }[]) {
            const blob = await fetch("/api/img/" + f.id + "?full=1").then((r) => r.blob());
            const fh = await dir.getFileHandle(f.filename, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            written++;
          }
          await playToolRow("export_folder", sourceName + " → " + dir.name, "written · " + written);
          pushOutcome([{ icon: "drive", text: dir.name + " · " + written + " files, where you chose" }]);
          logLedger("media manager", "saved " + sourceName + " into " + dir.name + " · " + written + " files");
        } catch (e) {
          pushAtlas("Writing there failed: " + (e instanceof Error ? e.message.slice(0, 120) : "unknown"));
        }
        pushNext(["save-local", "find", "sort"]);
        return;
      }
      /* no picker in this browser: the server mirrors to ~/Atlas Exports and
         opens the folder in Explorer so the files are in hand */
      try {
        const res = await fetch("/api/export", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...source, open: true }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "export failed");
        await playToolRow("export_folder", sourceName, "copied · " + d.count);
        pushOutcome([{ icon: "drive", text: d.path + " · " + d.count + " files · opened in Explorer" }]);
        logLedger("media manager", "mirrored " + sourceName + " to disk · " + d.count + " files");
      } catch (e) {
        pushAtlas("The disk door refused: " + (e instanceof Error ? e.message.slice(0, 120) : "unknown"));
      }
      pushNext(["save-local", "find", "sort"]);
      return;
    }

    /* the Curator's filter, driven from the conversation */
    if (key === "filter") {
      const top = kinds.flatMap((g) => g.items.slice(0, 3).map((t) => ({ ...t, kind: g.kind })))
        .sort((a, b) => b.count - a.count).slice(0, 6);
      if (!top.length) { pushAtlas("No keyterms yet."); return; }
      pushAtlas("Which keyterm should narrow the field? I can stack more than one.");
      pushCtas([...top.map((t) => ({ key: "term:" + t.name, label: t.name, sub: t.kind + " · " + t.count })), CTA_META.skills]);
      return;
    }
    if (key.startsWith("term:")) {
      const term = key.slice(5);
      setFilterTags((f) => (f.includes(term) ? f : [...f, term]));
      setPromptIds(null);
      logLedger("curator", "filtered by “" + term + "”");
      pushAtlas("Field narrowed to “" + term + "”. Stack another, or do something with these.");
      pushNext(["filter", "sort", "save"]);
      return;
    }

    /* the Archivist's integrity pass */
    if (key === "dedupe") {
      try {
        const d = await fetch("/api/dedupe").then((r) => r.json());
        if (!d.duplicates) { pushAtlas("The library is clean: no duplicate copies."); pushNext(["tag", "find"]); return; }
        await playToolRow("scan_duplicates", "sha256 + fingerprints", d.duplicates + " found");
        pushAtlas(d.duplicates + " duplicate cop" + (d.duplicates === 1 ? "y" : "ies") + " across " + d.groups + " group" + (d.groups === 1 ? "" : "s") + ". The highest-resolution copy of each survives; your source originals are untouched.");
        pushCtas([{ key: "dedupe-go", label: "Remove them", sub: "archivist" }, CTA_META.skills]);
      } catch {
        pushAtlas("The duplicate scan failed. Check the server log.");
      }
      return;
    }
    if (key === "dedupe-go") {
      try {
        const r = await fetch("/api/dedupe", { method: "POST" }).then((x) => x.json());
        await playToolRow("remove_duplicates", "keep highest resolution", "removed · " + r.removed);
        pushOutcome([{ icon: "check", text: r.removed + " duplicate cop" + (r.removed === 1 ? "y" : "ies") + " removed" }]);
        logLedger("archivist", "removed " + r.removed + " duplicates");
        router.refresh();
      } catch {
        pushAtlas("Removing them failed. Check the server log.");
      }
      pushNext(["tag", "find", "sort"]);
      return;
    }
    /* the contextual door (a folder row's Save…) still asks where it should live */
    if (key.startsWith("folder:")) {
      const c = collections.find((x) => x.id === Number(key.slice(7)));
      if (!c) return;
      pendingFolder.current = { id: c.id, name: c.name };
      pushAtlas("Where should “" + c.name + "” live? Originals are never touched.");
      pushCtas([
        { key: "save-atlas", label: "Keep in Atlas", sub: "searchable · on the field" },
        { key: "save-disk", label: "Save to disk", sub: "real files · ~/Atlas Exports" },
        { key: "save-both", label: "Both", sub: "digital and mirrored" },
      ]);
      return;
    }
    if (key === "save-atlas" || key === "save-disk" || key === "save-both") {
      const f = pendingFolder.current;
      if (!f) return;
      const rows: OutRow[] = [];
      if (key !== "save-disk") {
        rows.push({ icon: "foldercheck", text: f.name + " kept in Atlas" });
        logLedger("media manager", "kept “" + f.name + "” digital");
      }
      if (key !== "save-atlas") {
        try {
          const res = await fetch("/api/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionId: f.id }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "export failed");
          await playToolRow("export_folder", "“" + f.name + "”", "copied · " + d.count);
          rows.push({ icon: "drive", text: f.name + " → " + d.path + " · " + d.count + " files" });
          logLedger("media manager", "mirrored “" + f.name + "” to disk · " + d.count + " files");
        } catch (e) {
          pushAtlas("The disk door refused: " + (e instanceof Error ? e.message.slice(0, 120) : "unknown"));
        }
      }
      if (rows.length) pushOutcome(rows);
      pendingFolder.current = null;
      pushNext(["save", "sort", "find"]);
      return;
    }

    if (key === "post-save") {
      const ids = fieldIds();
      if (!ids.length) { pushAtlas("Nothing is on the field to file right now."); return; }
      const name = folderNameFrom(lastQueryRef.current);
      setThread((t) => [...t, { type: "proposal", name, note: "Named after your hunt.", ids, status: "pending" }]);
      logLedger("curator", "proposed “" + name + "” · " + ids.length + " images");
      return;
    }
    if (key === "post-release") {
      setPromptIds(null);
      logLedger("curator", "released the field");
      pushAtlas("Released. The whole library is back on the field.");
      return;
    }

    if (key === "timeline") {
      setThread((t) => [...t, { type: "timeline" }]);
      pushNext(["tag", "sort", "find", "save"]);
      return;
    }
  }

  async function sendPrompt(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || promptBusy) return;
    if (text.startsWith("/")) {
      setDraft("");
      const head = text.toLowerCase().split(/\s/)[0];
      const cmd = COMMANDS.find((c) => c.cmd.startsWith(head));
      if (cmd) void dispatchCta(cmd.key, cmd.label);
      else pushAtlas("No such command. Try " + COMMANDS.map((c) => c.cmd).join(", ") + ".");
      return;
    }
    lastQueryRef.current = text;
    pushStep({ kind: "prompt", text });
    retireCtas();
    const history = [...historyOf(thread), { role: "user" as const, content: text }];
    setThread((t) => [...t, { type: "msg", role: "user", content: text }]);
    setDraft("");
    if (!atlasEnabled()) {
      setThread((it) => [...it, { type: "msg", role: "assistant", content: "Atlas is switched off. Turn it on under Agents in the sidebar and I can act again." }]);
      return;
    }
    setPromptBusy(true);
    pushHead("sifting the archive");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, field: fieldIds(), historian: historianEnabled() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "the agent failed");
      let ltShown = false;
      for (const t of (d.toolLog ?? []) as { tool: string; args: Record<string, unknown>; result: string }[]) {
        /* the light table slides out AS the historian's row starts playing,
           so the finds are on the canvas while the work is still visible */
        if (!ltShown && t.tool === "search_outside" && d.candidates?.items?.length) {
          ltShown = true;
          setLightTable({ query: String(d.candidates.query ?? ""), items: d.candidates.items, totals: d.candidates.totals });
          setLtOpen(true);
        }
        await playToolRow(t.tool, fmtDetail(t.tool, t.args), fmtResult(t.result));
        logLedger(TOOL_META[t.tool]?.who ?? "curator", t.tool + " " + fmtDetail(t.tool, t.args));
      }
      /* Releasing is the one case where the agent hands back NO ids on
         purpose: it is asking the field to stop being narrowed rather than to
         show a different set. Handled before the ids, because an empty list
         means "found nothing" everywhere else. The sort goes with it, since
         "show everything again" means the library as it was, not the library
         re-formed into somebody's grid. */
      if (d.release) { setPromptIds(null); setFieldSort(null); }
      /* [] means the agent narrowed to nothing, not "show nothing": the
         field it found nothing in is the field worth keeping on screen */
      else if (Array.isArray(d.ids) && d.ids.length) setPromptIds(d.ids);
      if (d.sort) {
        /* "off" is the agent undoing its own grid: the set on the canvas is
           untouched, only the arrangement goes back to the field's own order */
        const off = d.sort.by === "off";
        const m = ["colour", "light", "period", "kind"].includes(d.sort.by) ? (d.sort.by as FieldSortMode) : "light";
        setFieldSort(off ? null : m);
        logLedger("curator", off ? "put the field back in its own order" : "sorted the field by " + d.sort.by + " · grid");
      }
      if (d.proposal) {
        setThread((it) => [...it, { type: "proposal", name: d.proposal.name, note: d.proposal.note ?? "", ids: d.proposal.ids, status: "pending" }]);
        logLedger("curator", "proposed “" + d.proposal.name + "” · " + d.proposal.ids.length + " images");
      }
      if (d.candidates && Array.isArray(d.candidates.items) && d.candidates.items.length) {
        setThread((it) => [...it, { type: "candidates", query: String(d.candidates.query ?? ""), items: d.candidates.items, totals: d.candidates.totals }]);
        logLedger("historian", "searched outside · " + d.candidates.items.length + " candidates");
      }
      closeHead("replied");
      setThread((it) => [...it, { type: "msg", role: "assistant", content: d.reply }]);
      if (d.candidates && Array.isArray(d.candidates.items) && d.candidates.items.length) {
        /* an outside hunt's follow-up is a REFINE surface, not generic
           chips: narrows to check, a source to go deeper into, and the
           human's own words — layered into the next hunt */
        const srcs = [...new Set((d.candidates.items as Candidate[]).map((c) => c.source))];
        const totals: Record<string, number> = d.candidates.totals ?? {};
        setThread((it) => [...it, {
          type: "refine",
          base: String(d.candidates.query ?? ""),
          sources: srcs.map((id) => ({ id, total: totals[id] ?? null })),
          sent: null,
        }]);
      } else if (Array.isArray(d.ids) && d.ids.length) {
        pushCtas([
          { key: "sort", label: "Sort these", sub: "curator" },
          { key: "post-save", label: "File these as a folder", sub: "proposes" },
          { key: "post-release", label: "Show everything again", sub: "release" },
        ]);
      } else if (!d.proposal) {
        pushNext(["find", "sort", "save"]);
      }
    } catch (e) {
      closeHead("stalled");
      setThread((it) => [...it, { type: "msg", role: "assistant", content: "That failed: " + (e instanceof Error ? e.message.slice(0, 140) : "unknown") + ". Try again." }]);
    } finally {
      setPromptBusy(false);
    }
  }

  async function acceptProposal(index: number) {
    const p = thread[index];
    if (!p || p.type !== "proposal" || p.status !== "pending") return;
    setThread((it) => it.map((x, i) => (i === index && x.type === "proposal" ? { ...x, status: "accepted" as const } : x)));
    logLedger("you", "accepted “" + p.name + "”");
    try {
      const res = await fetch("/api/agent/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, ids: p.ids }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "apply failed");
      /* The write is DONE the moment this resolves -- 361ms, measured.
         What used to make the folder crawl in was everything after it:
         first the tool rows, which held it 4.8 seconds, and then
         router.refresh(), which re-renders the whole page server-side --
         including the 925-node graph and its 4133 edges -- and takes about
         2.9 seconds to deliver one new sidebar row.

         So the sidebar is told directly and immediately. The refresh still
         runs, to reconcile counts and anything else the server knows, but
         nothing waits for it. */
      window.dispatchEvent(new CustomEvent("atlas:folder-created", {
        detail: { id: d.collectionId, name: d.name, count: d.filed },
      }));
      router.refresh();
      /* your Accept closed the last block; the filing opens a new one */
      pushHead("filing the accepted folder");
      await playToolRow("create_collection", "“" + d.name + "”", "created");
      await playToolRow("add_to_collection", d.filed + " ids → " + d.name, "filed · " + d.filed);
      logLedger("media manager", "filed " + d.filed + " into “" + d.name + "”");
      closeHead("filed");
      setThread((it) => [...it, { type: "msg", role: "assistant", content: "Filed. " + d.name + " is in your folders now." }]);
      pushNext(["save", "find", "sort"]);
    } catch (e) {
      setThread((it) => [...it, { type: "msg", role: "assistant", content: "Applying failed: " + (e instanceof Error ? e.message.slice(0, 120) : "unknown") }]);
    }
  }
  function rejectProposal(index: number) {
    const p = thread[index];
    if (p?.type === "proposal") logLedger("you", "rejected “" + p.name + "”");
    setThread((it) => it.map((x, i) => (i === index && x.type === "proposal" ? { ...x, status: "rejected" as const } : x)));
    setThread((it) => [...it, { type: "msg", role: "assistant", content: "Left everything untouched." }]);
    pushNext(["find", "sort", "save"]);
  }

  /* Clear undoes the conversation AND what the conversation did to the
     field. Releasing the ids but leaving the grid behind meant "Clear" left
     the canvas in a state only the cleared conversation had asked for.

     It does not blink out. The messages fold away bottom to top, each one
     collapsing to nothing as it fades, and the panel's height rides down
     WITH them: the panel is sized by its content, so pinning every item at
     its measured height and animating those heights to zero collapses the
     component in exact unison with the content clearing. Nothing here
     guesses at a target height. The container's gap eases out over the same
     sweep, or fourteen ghost pixels per message would be left standing
     after their messages had gone. */
  /* The panel grows the way it drains. Clearing folds each message away and
     the panel rides down with them; arriving is the mirror. Every element
     that lands in the thread OPENS -- height animated from nothing to its
     measured size, the container gap absorbed by an easing margin, content
     fading in -- and an element that grows in place (the thinking line
     becoming the reply) glides between its old height and its new one
     instead of stepping. WAAPI with measured pixels, because CSS cannot do
     this: Chrome drops height keyframes whose other end is auto, even with
     interpolate-size. Effects, not styles, so nothing lingers to fight the
     clear-drain inline styles later. */
  useEffect(() => {
    /* keyed on panelIn: the panel mounts AFTER the field has painted, so an
       effect that looked for .chatscroll once at mount found nothing and
       silently never attached */
    const scroll = document.querySelector(".chatscroll") as HTMLElement | null;
    if (!scroll || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
    const known = new WeakMap<Element, number>();

    /* The pin-keeper. The app pins the thread to its bottom when a row
       lands -- but it pins against a row this effect has just collapsed to
       zero, and the row then grows BELOW the fold: the newest message, and
       a proposal card whole buttons, ended up past the visible bottom with
       nothing re-pinning. So while any slot animation is running, if the
       thread was at its bottom when the animation began, it is HELD at the
       bottom every frame until the last animation ends. */
    let animating = 0;
    let holdPin = false;
    const pinLoop = () => {
      if (holdPin && scroll) scroll.scrollTop = scroll.scrollHeight;
      if (animating > 0) requestAnimationFrame(pinLoop);
      else holdPin = false;
    };
    const beginAnim = () => {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
      if (animating === 0) {
        holdPin = nearBottom;
        animating++;
        requestAnimationFrame(pinLoop);
      } else {
        holdPin = holdPin || nearBottom;
        animating++;
      }
    };
    const endAnim = () => { animating = Math.max(0, animating - 1); };

    const ro = new ResizeObserver((entries) => {
      /* the drain owns every height in here while it runs */
      if (scroll.dataset.draining) return;
      for (const e of entries) {
        const el = e.target as HTMLElement;
        /* While one of OUR animations drives this element, every reading is
           a mid-flight value: recording those into known is what once made
           each finished glide spawn the next -- an endless 24px->120px loop
           that held a proposal card collapsed for good. Skip entirely; the
           animation itself writes the terminal height when it lands. (The
           entry fade content-in fills forever, so the check names only the
           slot animations.) */
        if (el.getAnimations().some((a) => a.id.startsWith("slot-"))) continue;
        const h = el.getBoundingClientRect().height;
        const prev = known.get(el);
        known.set(el, h);
        if (prev === undefined || Math.abs(h - prev) < 8) continue;
        el.style.overflow = "hidden";
        beginAnim();
        const anim = el.animate(
          [{ height: prev + "px" }, { height: h + "px" }],
          { duration: 260, easing: EASE }
        );
        anim.id = "slot-glide";
        anim.onfinish = () => { el.style.overflow = ""; known.set(el, el.getBoundingClientRect().height); endAnim(); };
        anim.oncancel = () => { el.style.overflow = ""; endAnim(); };
      }
    });

    const open = (el: HTMLElement) => {
      /* Nothing opens during a drain. The home block lands in the same
         commit the thread is emptied, and playing its entry animation
         there meant it grew from nothing INSIDE the space the drain had
         just floored -- the panel dipped for a frame and sprang back. It
         belongs at full height immediately: the floor is already holding
         exactly its size. */
      if (scroll.dataset.draining) return;
      const h = el.getBoundingClientRect().height;
      if (h < 2) return;
      known.set(el, h);
      ro.observe(el);
      /* Inline the closed state BEFORE the animation exists: a fresh WAAPI
         animation is created pending and applies nothing until the next
         frame, so without this the browser paints the mutation frame at
         full height -- one visible pop, then a grow. Mutation callbacks run
         before paint; inline styles land in the same frame. */
      el.style.height = "0px";
      el.style.marginTop = "-14px";
      el.style.opacity = "0";
      el.style.overflow = "hidden";
      void el.offsetHeight;
      beginAnim();
      const anim = el.animate(
        [
          { height: "0px", marginTop: "-14px", opacity: 0, transform: "translateY(4px)" },
          { height: h + "px", marginTop: "0px", opacity: 1, transform: "none" },
        ],
        { duration: 320, easing: EASE }
      );
      anim.id = "slot-open";
      anim.onfinish = () => {
        el.style.height = ""; el.style.marginTop = ""; el.style.opacity = ""; el.style.overflow = "";
        known.set(el, el.getBoundingClientRect().height);
        endAnim();
      };
      anim.oncancel = () => {
        el.style.height = ""; el.style.marginTop = ""; el.style.opacity = ""; el.style.overflow = "";
        endAnim();
      };
    };

    for (const el of scroll.children) { known.set(el, el.getBoundingClientRect().height); ro.observe(el); }
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && n.parentElement === scroll) open(n);
      }
    });
    mo.observe(scroll, { childList: true });
    return () => { mo.disconnect(); ro.disconnect(); };
  }, [panelIn]);

  const clearingRef = useRef(false);
  function clearPrompt() {
    const finish = () => {
      clearingRef.current = false;
      /* boot resets in the SAME commit as the thread. The reset normally
         rides an effect, which runs after paint, so the home block mounted
         for one frame in its finished state -- text and all four
         capabilities at full height -- before snapping back to "thinking".
         After a 300px collapse, that flash read as the panel bouncing. */
      /* the home block arrives finished, and the drain below has already
         floored the panel at its height, so this settles rather than grows */
      skipBootRef.current = true;
      setBoot(2);
      setThread([]);
      setPromptIds(null);
      setFieldSort(null);
      setLightTable(null);
      setLtOpen(false);
      stepsRef.current = [];
      setSteps(0);
    };
    const scroll = document.querySelector(".chatscroll") as HTMLElement | null; // the view renders exactly one
    if (clearingRef.current) return;
    if (conversationCollapsed || !scroll || thread.length === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    clearingRef.current = true;

    scroll.dataset.draining = "1";
    /* Floor the collapse at the height the home block is about to occupy.
       Without it the panel fell all the way to nothing and then climbed
       back as home mounted -- collapse, pause, expand. With it the descent
       simply stops where home begins, and the swap changes no height at
       all. */
    if (homeHRef.current) scroll.style.minHeight = homeHRef.current + "px";
    const items = Array.from(scroll.children) as HTMLElement[];
    const heights = items.map((el) => el.offsetHeight);   // read before any write

    const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
    const DUR = 300;
    /* the sweep climbs the thread at a fixed step, capped so a long
       conversation drains in about half a second rather than scrolling
       credits */
    const step = Math.min(26, Math.max(8, Math.round(320 / items.length)));
    const total = (items.length - 1) * step + DUR;

    items.forEach((el, i) => {
      /* Cancel what is already animating this element FIRST. Every message
         still carries its entry fade, and any that grew in place carries a
         glide too -- both fill forwards, and a filled animation outranks
         inline styles. That is why the fade looked broken: the CSS
         transition set here could never run, so opacity did not ease at
         all, it snapped to zero the moment the old fill was dropped, and
         the height was left crawling down on its own afterwards. Measured
         on the first frame of a drain: four of six messages already at
         opacity 0 while still at their full 57, 32, 32 and 90 pixels. */
      el.getAnimations().forEach((a) => a.cancel());
      el.style.minHeight = "0";
      el.style.overflow = "hidden";
      /* ONE animation per element, carrying height and opacity together, so
         they cannot come apart again: the row shrinks exactly as it fades. */
      el.animate(
        [
          { height: heights[i] + "px", opacity: 1, marginTop: "0px", marginBottom: "0px", paddingTop: getComputedStyle(el).paddingTop, paddingBottom: getComputedStyle(el).paddingBottom },
          { height: "0px", opacity: 0, marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" },
        ],
        { duration: DUR, delay: (items.length - 1 - i) * step, easing: EASE, fill: "both" },
      );
    });
    /* the row gaps go with them, over the whole sweep, or fourteen pixels
       per message would be left standing after the messages had gone */
    scroll.animate([{ rowGap: "14px" }, { rowGap: "0px" }], { duration: total, easing: EASE, fill: "both" });

    window.setTimeout(() => {
      finish();
      /* the container is released only after React has swapped the zeroed
         items for the home block: released in the same tick, the gaps
         reappeared under zero-height messages for one frame and the panel
         visibly bounced before settling */
      /* The flag outlives the swap by a frame so the home block mounts
         under it and skips its entry animation, then the floor and the
         flag come off together -- home is already filling the space. */
      requestAnimationFrame(() => {
        scroll.getAnimations().forEach((a) => a.cancel());
        requestAnimationFrame(() => {
          delete scroll.dataset.draining;
          scroll.style.minHeight = "";
        });
      });
    }, total + 60);
  }

  /* upload an image; the field re-forms around its closest matches. The
     upload is fingerprinted in memory and never joins the library. */
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSimBusy(true);
    setThread((t) => [...t, { type: "msg", role: "user", content: "[image] " + f.name }]);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/similar", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "similarity search failed");
      setPromptIds(d.ids);
      logLedger("curator", "matched " + f.name + " · " + d.ids.length + " images");
      setThread((t) => [...t, {
        type: "msg",
        role: "assistant",
        content: "Formed the field around the " + d.ids.length + " closest matches to " + f.name + ".",
      }]);
    } catch (err) {
      setThread((t) => [...t, {
        type: "msg",
        role: "assistant",
        content: "That failed: " + (err instanceof Error ? err.message.slice(0, 140) : "unknown") + ". Try again.",
      }]);
    } finally {
      setSimBusy(false);
    }
  }

  async function disconnectEdge(e: React.MouseEvent) {
    e.preventDefault();
    if (!showWiresRef.current) return;
    const edge = pickEdge(e.clientX, e.clientY);
    if (!edge) return;
    const ok = await dialogs.confirm({
      title: "Disconnect these two images?",
      message: edge.kind === "manual"
        ? "This removes the link you drew between them."
        : "This severs the automatic connection; it will not be drawn again.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const cut = await write("/api/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: edge.source, b: edge.target, kind: edge.kind }),
    });
    if (!cut.ok) {
      await dialogs.alert({ title: "Still connected", message: cut.message });
      return;
    }
    await loadGraph();
  }

  async function createLink(fromId: number, toId: number) {
    setLinking(true);
    try {
      const made = await write("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId, toId, kind: "relates" }),
      });
      if (!made.ok) {
        await dialogs.alert({ title: "Link not drawn", message: made.message });
        return;
      }
      await loadGraph();
    } finally {
      setLinking(false);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // right/middle clicks never drag, pan, or wire
    const s = sim.current;
    const port = pickPort(e.clientX, e.clientY);
    if (port) {
      const w = toWorld(e.clientX, e.clientY);
      s.wiring = { from: port, toX: w.x, toY: w.y };
    } else {
      const hit = pick(e.clientX, e.clientY);
      if (hit) s.dragging = hit;
      else s.panning = true;
    }
    s.lastX = e.clientX; s.lastY = e.clientY;
    s.downX = e.clientX; s.downY = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = sim.current;
    if (s.wiring || s.dragging || s.panning) { s.hoveredEdge = null; setEdgeTip(null); }
    if (s.wiring) {
      const w = toWorld(e.clientX, e.clientY);
      s.wiring.toX = w.x; s.wiring.toY = w.y;
      const over = pick(e.clientX, e.clientY);
      s.hovered = over && over !== s.wiring.from ? over : null;
    } else if (s.dragging) {
      const w = toWorld(e.clientX, e.clientY);
      s.dragging.x = w.x; s.dragging.y = w.y;
    } else if (s.panning) {
      s.ox += e.clientX - s.lastX;
      s.oy += e.clientY - s.lastY;
      s.lastX = e.clientX; s.lastY = e.clientY;
    } else {
      const hov = pick(e.clientX, e.clientY);
      s.hovered = hov;
      s.hoveredEdge = hov || !showWiresRef.current ? null : pickEdge(e.clientX, e.clientY);
      const wrap = wrapRef.current!.getBoundingClientRect();
      setTip(hov ? { id: hov.id, label: hov.label, x: e.clientX - wrap.left, y: e.clientY - wrap.top } : null);
      /* a hovered wire explains itself: what KIND of connection, and what
         actually joins the two images (score, shared keyterms, or a hand) */
      const he = s.hoveredEdge;
      if (he) {
        const na = s.byId.get(he.source), nb = s.byId.get(he.target);
        const shared = na && nb ? na.tags.filter((t) => nb.tags.includes(t)).slice(0, 4) : [];
        const title = he.kind === "manual"
          ? "Manual link"
          : he.kind === "tag"
            ? "Keyterm connection"
            : "Similarity " + Math.round(he.score * 100) + "% · " + simMode;
        const desc = he.kind === "manual"
          ? "drawn by hand between these two"
          : shared.length
            ? "shared: " + shared.join(", ")
            : he.kind === "tag" ? null : "visual fingerprint match";
        setEdgeTip({ x: e.clientX - wrap.left, y: e.clientY - wrap.top, title, desc });
      } else {
        setEdgeTip(null);
      }
      canvasRef.current!.style.cursor = pickPort(e.clientX, e.clientY) ? "crosshair" : hov || s.hoveredEdge ? "pointer" : "var(--cursor-grab)";
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (e.button !== 0) return; // right-click is disconnect's, never diptych's
    const s = sim.current;
    const wasDrag = s.dragging;
    const wasWiring = s.wiring;
    const moved = Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > 5;
    s.dragging = null; s.panning = false; s.wiring = null;

    if (wasWiring) {
      const target = pick(e.clientX, e.clientY);
      if (target && target.id !== wasWiring.from.id) createLink(wasWiring.from.id, target.id);
      return;
    }
    if (moved) return;
    if (wasDrag) {
      setSelected(wasDrag.id);
      setTrail([]);
      return;
    }
    const edge = showWiresRef.current ? pickEdge(e.clientX, e.clientY) : null;
    if (edge) window.location.href = "/diptych?a=" + edge.source + "&b=" + edge.target;
  }
  function onWheel(e: React.WheelEvent) {
    const s = sim.current;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.08, Math.min(6, s.scale * factor));
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    s.ox = mx - ((mx - s.ox) * next) / s.scale;
    s.oy = my - ((my - s.oy) * next) / s.scale;
    s.scale = next;
  }

  /* the pill tells the truth: the pool it reports is the SAME pool the
     field forms from, prompt results included */
  const poolSize = useMemo(() => {
    let pool = filterTags.length
      ? raw.nodes.filter((n) => filterTags.every((t) => n.tags.includes(t)))
      : raw.nodes;
    const q = effectiveQ;
    if (q) {
      pool = pool.filter((n) =>
        n.label.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)));
    }
    if (promptIds) {
      const rank = new Set(promptIds);
      pool = pool.filter((n) => rank.has(n.id));
    }
    return pool.length;
  }, [raw.nodes, filterTags, effectiveQ, promptIds]);


  /* the tuning controls, shared by the desktop dropdown and the mobile
     filter drawer */
  const tuneControls = (
    <>
      <Select
        value={simMode}
        onChange={(v) => setSimMode(v as typeof simMode)}
        ariaLabel="What similarity means"
        width="100%"
        options={[
          { value: "blend", label: "Similarity: blend" },
          { value: "structure", label: "Similarity: structure" },
          { value: "color", label: "Similarity: colour" },
          { value: "aesthetic", label: "Similarity: aesthetic" },
        ]}
      />
      <label>
        <span className="mono-xs">cards on field · {cap >= poolSize && poolSize > 0 ? "all " + poolSize : cap}</span>
        <input
          type="range" min="20" max={Math.max(60, poolSize)} step="10"
          value={Math.min(cap, Math.max(60, poolSize))}
          onChange={(e) => setCap(Number(e.target.value))}
        />
      </label>
      <label>
        <span className="mono-xs">similarity ≥ {(minScore * 100).toFixed(0)}%</span>
        <input
          type="range" min="0.7" max="0.95" step="0.01"
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
        />
      </label>
      <div className="graph-tune__toggle">
        <span className="mono-xs">connections</span>
        <button
          type="button"
          className={"graph-switch" + (showWires ? " is-on" : "")}
          onClick={() => setWires(!showWires)}
          role="switch"
          aria-checked={showWires}
          aria-label="Show connections"
        >
          <span aria-hidden>{showWires ? "on" : "off"}</span>
          <i aria-hidden />
        </button>
      </div>
    </>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Network</h1>
          <span className="pill pill--static">{poolSize} media</span>
          {linking && <span className="pill pill--static"><span className="spin" style={{ width: 10, height: 10 }} /> linking</span>}
        </div>
        <div className="topbar__spacer" />
        <ThemeToggle />
      </header>
      <div className="work">
        <main className="pane pane--flush" tabIndex={-1}>
          <div className="graph-stage" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
              onContextMenu={disconnectEdge}
            />
            <div className="graph-top">
              <div className="graph-rail">
                <div className={"viewswitch" + (panel === "search" ? " is-search" : "")} role="group" aria-label="Mode">
                  {/* Switching mode shows a different panel. That is ALL it does.
                      Search used to call clearPrompt() on the way in, which threw away the
                      conversation, the ids the agent had put on the field, the colour grid and the
                      undo history: a whole session, discarded by a control that looks like a tab.
                      Nothing needed it. effectiveQ below already ignores the query outside search
                      mode, so a stale query cannot silently intersect the agent's results, and the
                      input says "Search the field" because that is what it does: it narrows what
                      is showing rather than starting again. Clear, in the conversation's own head,
                      is the one door that empties it. */}
                  <button className={panel === "prompt" ? "is-active" : ""} onClick={() => { setPanel("prompt"); setSheetOpen(true); }}>Prompt</button>
                  <button className={panel === "search" ? "is-active" : ""} onClick={() => { setPanel("search"); setSheetOpen(true); }}>Search</button>
                </div>
                <button
                  className={"graph-rail__cat graph-filterbtn" + (filterTags.length > 0 ? " has-active" : "")}
                  onClick={() => { setFilterSheetOpen(true); setSheetOpen(false); }}
                >
                  Filter
                  {filterTags.length > 0 && <span className="cat-count">{filterTags.length}</span>}
                </button>
                <div className="graph-rail__cats">
                  {kinds.map((g) => {
                    const selCount = g.items.filter((t) => filterTags.includes(t.name)).length;
                    const visibleTerms = alphabetizeTerms(narrowTerms(g.items));
                    const filterPanelId = "graph-filter-panel-" + g.kind;
                    return (
                      <span key={g.kind} className="graph-catwrap" data-filter-kind={g.kind}>
                        <button
                          type="button"
                          id={"graph-filter-trigger-" + g.kind}
                          className={
                            "graph-rail__cat" +
                            (openKind === g.kind ? " is-open" : "") +
                            (selCount > 0 ? " has-active" : "")
                          }
                          onClick={() => setOpenKind(openKind === g.kind ? null : g.kind)}
                          aria-expanded={openKind === g.kind}
                          aria-controls={filterPanelId}
                        >
                          {KIND_LABEL[g.kind] ?? g.kind}
                          {selCount > 0 && <span className="cat-count">{selCount}</span>}
                          {" "}<i>▾</i>
                        </button>
                        {openKind === g.kind && (
                          <div
                            id={filterPanelId}
                            className="graph-drop graph-drop--terms"
                            role="group"
                            aria-label={(KIND_LABEL[g.kind] ?? g.kind) + " filters"}
                          >
                            {g.items.length > TERM_SEARCH_AT && (
                              <div className="drop-find">
                                <input
                                  autoFocus
                                  value={termQ}
                                  placeholder={"Search " + g.items.length + " " + (KIND_LABEL[g.kind] ?? g.kind).toLowerCase() + " terms..."}
                                  onChange={(e) => setTermQ(e.target.value)}
                                  aria-label={"Narrow the " + g.kind + " list"}
                                />
                                {termQ && <span className="drop-find__n" role="status" aria-live="polite">{visibleTerms.length} of {g.items.length}</span>}
                              </div>
                            )}
                            <div className="graph-drop__list">
                              {visibleTerms.length === 0 && (
                                <span className="drop-find__none">nothing matches &ldquo;{termQ}&rdquo;</span>
                              )}
                              {visibleTerms.map((t) => (
                                <FilterCheckboxRow
                                  key={t.id}
                                  term={t}
                                  checked={filterTags.includes(t.name)}
                                  onToggle={toggleFilterTag}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </span>
                    );
                  })}
                  {filterTags.length > 0 && (
                    <button
                      className="graph-rail__clear"
                      onClick={() => setFilterTags([])}
                      title="Remove all selected keyterms"
                    >
                      Clear<span className="cat-count">{filterTags.length}</span>
                    </button>
                  )}
                </div>
                <div className="graph-rail__spacer" />
                <span className="graph-catwrap graph-tunewrap">
                  <button
                    type="button"
                    id="graph-filter-trigger-tune"
                    className={"graph-rail__cat" + (openKind === "tune" ? " is-open" : "")}
                    onClick={() => setOpenKind(openKind === "tune" ? null : "tune")}
                    aria-expanded={openKind === "tune"}
                    aria-controls="graph-filter-panel-tune"
                  >
                    Settings <i>▾</i>
                  </button>
                  {openKind === "tune" && (
                    <div id="graph-filter-panel-tune" className="graph-drop graph-drop--tune">{tuneControls}</div>
                  )}
                </span>
                <span className="graph-catwrap graph-helpwrap">
                  <button
                    type="button"
                    id="graph-filter-trigger-help"
                    className={"graph-rail__cat" + (openKind === "help" ? " is-open" : "")}
                    onClick={() => setOpenKind(openKind === "help" ? null : "help")}
                    aria-label="How the field works"
                    title="How the field works"
                    aria-expanded={openKind === "help"}
                    aria-controls="graph-filter-panel-help"
                  >
                    <i className="info-i" aria-hidden />
                  </button>
                  {openKind === "help" && (
                    <div id="graph-filter-panel-help" className="graph-drop graph-drop--help">
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" /></svg>
                        <span className="mono-xs">pan to spawn more of the field</span>
                      </div>
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><circle cx="3.2" cy="8" r="1.8" /><path d="M5 8h6.5M11.5 8 9.5 6M11.5 8l-2 2" /></svg>
                        <span className="mono-xs">drag a port onto a card to connect</span>
                      </div>
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="1.7" /></svg>
                        <span className="mono-xs">hover a wire to see what it means</span>
                      </div>
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><rect x="1.5" y="3.5" width="5.6" height="9" rx="1" /><rect x="8.9" y="3.5" width="5.6" height="9" rx="1" /></svg>
                        <span className="mono-xs">click a wire for a diptych</span>
                      </div>
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 8h4.5M10 8h4.5M8.9 5.9l-1.8 4.2" /></svg>
                        <span className="mono-xs">right-click a wire to disconnect</span>
                      </div>
                      <div className="help-row">
                        <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 8s2.4-4 6.5-4c1.2 0 2.3.35 3.2.85M14.5 8s-2.4 4-6.5 4c-1.2 0-2.3-.35-3.2-.85M2.5 13.5l11-11" /></svg>
                        <span className="mono-xs">hide connections under tune</span>
                      </div>
                    </div>
                  )}
                </span>
              </div>

              {/* mobile: the whole filter section as a bottom drawer */}
              <div className={"graph-below graph-filtersheet" + (filterSheetOpen ? " is-open" : "")} aria-label="Filters">
                <div
                  className="sheet-grab"
                  onPointerDown={grabDown}
                  onPointerMove={grabMove}
                  onPointerUp={(e) => grabUp(e, () => setFilterSheetOpen(false))}
                  onPointerCancel={(e) => grabUp(e, () => {})}
                ><i aria-hidden /></div>
                <div className="filtersheet__head">
                  <span className="mono-label">Filters</span>
                  <div className="filtersheet__actions">
                    {filterTags.length > 0 && (
                      <button className="graph-rail__clear" onClick={() => setFilterTags([])}>
                        Clear<span className="cat-count">{filterTags.length}</span>
                      </button>
                    )}
                    <button className="closebtn" onClick={() => setFilterSheetOpen(false)}>Close</button>
                  </div>
                </div>
                <div className="filtersheet__scroll">
                  {kinds.map((g) => {
                    const sel = g.items.filter((t) => filterTags.includes(t.name)).length;
                    const open = openFilterSec === g.kind;
                    return (
                      <div key={g.kind} className={"fsec" + (open ? " is-open" : "")}>
                        <button
                          className="fsec__head"
                          onClick={() => setOpenFilterSec(open ? null : g.kind)}
                          aria-expanded={open}
                        >
                          <IconCaret className={"term-group__caret" + (open ? " is-open" : "")} />
                          <span className="mono-xs fsec__kind">{KIND_LABEL[g.kind] ?? g.kind}</span>
                          {sel > 0 && <span className="cat-count">{sel}</span>}
                          <span className="fsec__total">{g.items.length}</span>
                        </button>
                        <div className={"fsec__wrap" + (open ? " is-open" : "")}>
                          <div className="fsec__list">
                            {g.items.length > TERM_SEARCH_AT && (
                              <div className="drop-find drop-find--sheet">
                                <input
                                  value={termQ}
                                  placeholder={"Search " + g.items.length + " terms..."}
                                  onChange={(e) => setTermQ(e.target.value)}
                                  tabIndex={open ? 0 : -1}
                                  aria-label={"Narrow the " + g.kind + " list"}
                                />
                              </div>
                            )}
                            {narrowTerms(g.items).map((t) => {
                              const on = filterTags.includes(t.name);
                              return (
                                <FilterCheckboxRow
                                  key={t.id}
                                  term={t}
                                  checked={on}
                                  onToggle={toggleFilterTag}
                                  tabIndex={open ? 0 : -1}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className={"fsec" + (openFilterSec === "tune" ? " is-open" : "")}>
                    <button
                      className="fsec__head"
                      onClick={() => setOpenFilterSec(openFilterSec === "tune" ? null : "tune")}
                      aria-expanded={openFilterSec === "tune"}
                    >
                      <IconCaret className={"term-group__caret" + (openFilterSec === "tune" ? " is-open" : "")} />
                      <span className="mono-xs fsec__kind">Settings</span>
                      <span className="fsec__total" />
                    </button>
                    <div className={"fsec__wrap" + (openFilterSec === "tune" ? " is-open" : "")}>
                      <div className="fsec__tune">{tuneControls}</div>
                    </div>
                  </div>
                </div>
              </div>

              {panelIn && panel === "search" && (
                <div className={"graph-below" + (sheetOpen && !filterSheetOpen ? " is-open" : "")}>
                  <div
                    className="sheet-grab"
                    onPointerDown={grabDown}
                    onPointerMove={grabMove}
                    onPointerUp={(e) => grabUp(e, () => setSheetOpen(false))}
                    onPointerCancel={(e) => grabUp(e, () => {})}
                  ><i aria-hidden /></div>
                  <div className="filtersheet__head sheet-only">
                    <span className="mono-label">Search</span>
                    <button className="closebtn" onClick={() => setSheetOpen(false)}>Close</button>
                  </div>
                  <div className="graph-rail__input">
                    <input
                      value={searchQ}
                      placeholder="Search the field: title, keyterm, artist, anything..."
                      onChange={(e) => setSearchQ(e.target.value)}
                      aria-label="Search the field"
                    />
                    {searchQ && (
                      <button className="xbtn" onClick={() => setSearchQ("")} aria-label="Clear search" title="Clear">
                        <IconX width={11} height={11} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {panelIn && panel === "prompt" && (
                /* chatdock: the panel plus its light-table drawer, one piece
                   of furniture — the drawer docks behind the panel's right
                   edge and slides out when outside finds arrive */
                <div className="chatdock">
                <div className={"graph-below graph-below--chat" + (conversationCollapsed ? " is-collapsed" : "") + (sheetOpen && !filterSheetOpen ? " is-open" : "")}>
                  <div
                    className="sheet-grab"
                    onPointerDown={grabDown}
                    onPointerMove={grabMove}
                    onPointerUp={(e) => grabUp(e, () => setSheetOpen(false))}
                    onPointerCancel={(e) => grabUp(e, () => {})}
                  ><i aria-hidden /></div>
                  <div className="chatbox">
                    <div className="chathead">
                      <span className={"mono-label graph-topic" + (topic ? " has-topic" : "")} title={topic ?? undefined}>
                        {topic ?? "Conversation"}
                      </span>
                      <div className="filtersheet__actions">
                        {(thread.length > 0 || promptIds) && (
                          <button className="closebtn" onClick={clearPrompt} title="Clear the conversation">Clear</button>
                        )}
                        <button className="closebtn sheet-only" onClick={() => setSheetOpen(false)}>Close</button>
                        <button
                          type="button"
                          className="chathead__toggle"
                          onClick={() => setConversationCollapsed((collapsed) => !collapsed)}
                          aria-expanded={!conversationCollapsed}
                          aria-controls="graph-conversation-content"
                          aria-label={conversationCollapsed ? "Expand conversation" : "Collapse conversation"}
                          title={conversationCollapsed ? "Expand conversation" : "Collapse conversation"}
                        >
                          <IconChevronDown
                            width={14}
                            height={14}
                            className={"chathead__chevron" + (conversationCollapsed ? "" : " is-expanded")}
                          />
                        </button>
                      </div>
                    </div>
                    <div
                      id="graph-conversation-content"
                      className="conversation-body"
                      hidden={conversationCollapsed}
                    >
                    <div className="chatscroll">
                    {thread.length === 0 && !promptBusy && (
                      <div className="agent-home">
                        <div className="chat-msg is-ai">
                          <span className="mono-xs">atlas</span>
                          {boot === 0 ? (
                            <p className="agent-home__think"><GlyphLoader size={15} working /></p>
                          ) : (
                            <p className="agent-home__say">{readOnly
                              ? "One agent, three lenses. Ask me to hunt through the archive, filter it by keyterm, or sort what is showing into a grid. This is the public copy, so I can look but not write: tagging and filing need the local build."
                              : "One agent, three lenses. Find or filter to narrow the field, sort what is showing, save what is worth keeping. Type “/” for every command, or just ask."}</p>
                          )}
                        </div>
                        {boot >= 2 && (
                          <div className="agent-ctas">
                            {(readOnly ? READ_ONLY_CTAS : HOME_CTAS).map((o, i) => (
                              <button
                                key={o.key}
                                className="agent-cta agent-cta--reveal"
                                style={{ animationDelay: i * 80 + "ms" }}
                                onClick={() => void dispatchCta(o.key, o.label)}
                              >
                                <CtaFace opt={o} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {thread.map((m, i) => {
                      const lastAi = (() => {
                        for (let k = thread.length - 1; k >= 0; k--) {
                          const x = thread[k];
                          if (x.type === "msg" && x.role === "assistant") return k;
                        }
                        return -1;
                      })();
                      const nested = nestedFlags[i] ? " is-nested" : "";
                      if (m.type === "head") {
                        /* the ident exists only while Atlas works: once the
                           turn completes it leaves entirely and the words
                           stand alone — "ATLAS · replied", nothing greyed */
                        return (
                          <div key={i} className="agent-turnhead">
                            {m.status === "running" && <ToolCheck running size={15} />}
                            <span className="agent-turnhead__who">atlas</span>
                            <span className="agent-turnhead__what">· {m.what}</span>
                          </div>
                        );
                      }
                      if (m.type === "msg") {
                        return (
                          <div key={i} className={"chat-msg " + (m.role === "user" ? "is-user" : "is-ai" + nested)}>
                            <span className="mono-xs">{m.role === "user" ? "you" : "atlas"}</span>
                            <p>{m.content}</p>
                            {m.role === "assistant" && (
                              <div className="msg-acts">
                                {i === lastAi && steps > 0 && (
                                  <button
                                    onClick={undoLast}
                                    disabled={promptBusy}
                                    title="Undo this exchange"
                                    aria-label="Undo this exchange"
                                  >
                                    <IconUndo width={13} height={13} />
                                  </button>
                                )}
                                <button
                                  onClick={() => void copyReply(m.content, i)}
                                  title="Copy this reply"
                                  aria-label="Copy this reply"
                                >
                                  {copied === i ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (m.type === "tool") {
                        /* the row says WHO is at work and WHAT the work is;
                           the call itself survives on hover and in the ledger */
                        const meta = TOOL_META[m.tool];
                        return (
                          <div
                            key={i}
                            className={"agent-tool" + (m.status === "running" ? " is-running" : "") + nested}
                            title={m.tool + (m.detail ? "(" + m.detail + ")" : "()")}
                          >
                            <ToolCheck running={m.status === "running"} mode={meta?.mode} />
                            <span className="agent-tool__label">
                              {meta && <i className="agent-tool__who">{meta.who}</i>}
                              <b>{meta ? meta.task : m.tool}</b>
                              {!meta && (m.detail ? "(" + m.detail + ")" : "()")}
                            </span>
                            <span className="agent-tool__res">{m.status === "running" ? "working…" : m.result}</span>
                          </div>
                        );
                      }
                      if (m.type === "ctas") {
                        return (
                          <div key={i} className={"agent-ctas" + (m.picked ? " is-done" : "")}>
                            {m.options.map((o) => (
                              <button
                                key={o.key}
                                className={"agent-cta" + (m.picked === o.key ? " is-picked" : "")}
                                disabled={!!m.picked}
                                onClick={() => onCta(i, o.key, o.label)}
                              >
                                <CtaFace opt={o} />
                              </button>
                            ))}
                          </div>
                        );
                      }
                      if (m.type === "timeline") {
                        return (
                          <div key={i} className="agent-tl">
                            <span className="mono-label">History · this session</span>
                            {ledger.current.length === 0 ? (
                              <p className="agent-tl__empty">Nothing yet. Every hunt, sort, proposal and decision from this session collects here.</p>
                            ) : ledger.current.map((e, j) => (
                              <div key={j} className="agent-tl__row">
                                <span className="agent-tl__t">{e.t}</span>
                                <span className={"agent-tl__who" + (e.who === "you" ? " is-you" : "")}>{e.who}</span>
                                <span className="agent-tl__what">{e.what}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      if (m.type === "skills") {
                        return (
                          <div key={i} className="agent-skills">
                            <span className="mono-label">Everything I can do</span>
                            {SKILLS.map((grp) => (
                              <div key={grp.arch} className="agent-skills__grp">
                                <div className="agent-skills__head">
                                  <b>{grp.arch}</b><span>{grp.note}</span>
                                </div>
                                <div className="agent-ctas">
                                  {grp.keys.map((k) => {
                                    const o = CTA_META[k];
                                    return (
                                      <button key={k} className="agent-cta" onClick={() => void dispatchCta(o.key, o.label)}>
                                        <CtaFace opt={o} />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      if (m.type === "outcome") {
                        return (
                          <div key={i} className={"agent-out" + nested}>
                            {m.rows.map((r, j) => (
                              <div key={j} className="agent-out__row">
                                <OutIcon kind={r.icon} />
                                <span>{r.text}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      if (m.type === "refine") {
                        return (
                          <RefineBlock
                            key={i}
                            item={m}
                            busy={promptBusy}
                            onGo={(text) => {
                              setThread((it) => it.map((x, j) => (j === i && x.type === "refine" ? { ...x, sent: text } : x)));
                              void sendPrompt(text);
                            }}
                          />
                        );
                      }
                      if (m.type === "candidates") {
                        /* the images live on the light table, docked to the
                           panel's right; the thread keeps a one-line trace
                           that can put them back on it */
                        return (
                          <div key={i} className={"agent-cands agent-cands--line" + nested}>
                            <div className="agent-cands__t">
                              from outside · “{m.query}” · {m.items.length} candidate{m.items.length === 1 ? "" : "s"},{" "}
                              {m.items.filter((c) => c.keepable).length} keepable
                            </div>
                            <button
                              className="agent-cands__open"
                              onClick={() => { setLightTable({ query: m.query, items: m.items, totals: m.totals }); setLtOpen(true); }}
                            >
                              on the light table
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className={"agent-prop" + (m.status !== "pending" ? " is-" + m.status : "") + nested}>
                          <div className="agent-prop__t">proposal · needs you</div>
                          <p>
                            Create <b>{m.name}</b> and file {m.ids.length} image{m.ids.length === 1 ? "" : "s"} into it.
                            {m.note ? " " + m.note : ""} Nothing is written until you accept.
                          </p>
                          {m.status === "pending" ? (
                            <div className="agent-prop__row">
                              <button className="agent-prop__yes" onClick={() => acceptProposal(i)}>Accept</button>
                              <button className="agent-prop__no" onClick={() => rejectProposal(i)}>Reject</button>
                            </div>
                          ) : (
                            <span className="mono-xs" style={{ color: m.status === "accepted" ? "var(--accent)" : "#dc2626" }}>
                              {m.status}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {/* the turn's head narrates a prompt turn; this line only
                        stands in when no head is running (image matching,
                        scripted flows) */}
                    {(promptBusy || simBusy) && !headRunning && (
                      <div className="chat-msg is-ai">
                        <span className="mono-xs">atlas</span>
                        <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <GlyphLoader size={15} working /> {simBusy ? "matching the image" : "sifting the archive"}
                        </p>
                      </div>
                    )}
                      {(thread.length > 0 || promptBusy) && <div ref={threadEndRef} />}
                    </div>
                    {draft.trim().startsWith("/") && (
                      <div className="agent-palette" aria-label="Commands">
                        {COMMANDS.filter((c) => c.cmd.startsWith(draft.trim().toLowerCase().split(/\s/)[0])).map((c) => (
                          <button
                            key={c.cmd}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); setDraft(""); void dispatchCta(c.key, c.label); }}
                          >
                            <b>{c.cmd}</b>
                            <span>{c.hint}</span>
                            <i>{c.arch}</i>
                          </button>
                        ))}
                      </div>
                    )}
                    <form className="graph-ci" onSubmit={(e) => { e.preventDefault(); sendPrompt(); }}>
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                      <button
                        type="button"
                        className="graph-ci__icon"
                        onClick={() => fileRef.current?.click()}
                        disabled={promptBusy || simBusy || readOnly}
                        title={readOnly
                          ? "Matching an upload needs the local build"
                          : "Upload an image to find similar in the library"}
                        aria-label="Upload an image to find similar"
                      >
                        <IconPlus width={14} height={14} />
                      </button>
                      <textarea
                        ref={composerRef}
                        className="graph-ci__text"
                        rows={1}
                        /* Disabled rather than left open to fail. The hosted archive refuses the
                           model call, and a composer that takes a question and answers it with a
                           403 is worse than one that says so before you type. */
                        placeholder={readOnly
                          ? "Ask me to find something. Filing needs the local build."
                          : "Describe what you are hunting for..."}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); } }}
                        disabled={promptBusy}
                      />
                      <button className="graph-ci__send" type="submit" disabled={promptBusy || simBusy || !draft.trim()} aria-label="Send">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                        </svg>
                      </button>
                    </form>
                    </div>
                  </div>
                </div>
                {lightTable && (
                  <aside className={"lighttable" + (ltOpen ? " is-in" : "")} aria-label="Outside finds, temporary">
                    <div className="lt__head">
                      <span className="lt__t">from outside · temporary</span>
                      <span className="lt__sub">nothing is written</span>
                    </div>
                    <div className="lt__grid">
                      {lightTable.items.filter((c) => c.thumbUrl).map((c) => (
                        <a
                          key={c.source + c.remoteId}
                          className="lt__cell"
                          href={c.pageUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={c.title + (c.creator ? " — " + c.creator : "") + (c.licence ? " · " + c.licence : "")}
                        >
                          <span className="lt__tile">
                            {/* same manners as the strip had: a refused thumb
                                retries once, then yields to its title card */}
                            <img
                              src={c.thumbUrl!}
                              alt={c.title}
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                const img = e.currentTarget;
                                if (!img.dataset.retried) {
                                  img.dataset.retried = "1";
                                  const src = img.src;
                                  window.setTimeout(() => { img.src = src; }, 3500 + Math.random() * 2500);
                                  return;
                                }
                                img.closest(".lt__tile")?.classList.add("is-dead");
                              }}
                            />
                            <span className="lt__fallback" aria-hidden="true">{c.title}</span>
                            <span className="lt__src">{c.source}{c.keepable ? " · CC0" : ""}</span>
                          </span>
                          <span className="lt__cap">{c.title}</span>
                        </a>
                      ))}
                    </div>
                    <div className="lt__foot">
                      <span className="lt__note">
                        {lightTable.items.length} candidate{lightTable.items.length === 1 ? "" : "s"} ·{" "}
                        {lightTable.items.filter((c) => c.keepable).length} keepable
                        {(() => {
                          /* the population behind the preview: the sources'
                             own count of what these probes matched */
                          const pop = Object.values(lightTable.totals ?? {}).reduce((a, b) => a + b, 0);
                          return pop > lightTable.items.length
                            ? " · the sources hold ~" + pop.toLocaleString("en-GB") + " matches"
                            : "";
                        })()}
                        {" "}— a candidate opens at its source.
                      </span>
                      <button className="lt__go" onClick={() => setLtOpen(false)}>let go</button>
                    </div>
                  </aside>
                )}
                </div>
              )}
            </div>

            {tip && (
              <div className="graph-tip" style={{ left: tip.x, top: tip.y }}>
                <img src={"/api/img/" + tip.id} alt="" />
                <div className="t">{tip.label}</div>
              </div>
            )}
            {edgeTip && (
              <div className="graph-edgetip" style={{ left: edgeTip.x, top: edgeTip.y }}>
                <div className="t">{edgeTip.title}</div>
                {edgeTip.desc && <div className="d">{edgeTip.desc}</div>}
                <div className="acts">
                  <span><b>click</b> diptych</span>
                  <span><b>right-click</b> disconnect</span>
                </div>
              </div>
            )}
          </div>
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
              onRowPatch={() => {}}
              onRemoved={() => loadGraph().catch(() => {})}
            />
          </div>
        )}
      </div>
    </>
  );
}
