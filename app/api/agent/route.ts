import Anthropic from "@anthropic-ai/sdk";
import { canonical } from "@/lib/taxonomy";
import { db } from "@/lib/db";
import { listImages } from "@/lib/queries";
import { IS_HOSTED_READ_ONLY } from "@/lib/runtime";
import { listConnections } from "@/lib/connections";
import { searchConnected, MEDIUMS, type Candidate } from "@/lib/sources";
import { recordEvent, probeMemory } from "@/lib/events";
import type { ChatMsg } from "@/lib/vision";

export const maxDuration = 120;

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
/* overridable so the loop can run against a local OpenAI-compatible server —
   LM Studio, ollama, or a test fixture — without touching this file */
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/*
  The hosted archive runs the agent on a small model with a short round budget.

  It is a public URL, so every visitor who types spends tokens on somebody
  else's key. The work is narrow -- pick two or three tools from a list of six
  and say one sentence -- and a mini model does it as well as a large one, at a
  fraction of the cost. Four rounds is enough for search, filter, show; a loop
  that wants more than that is going in circles rather than converging.
*/
const HOSTED_MODEL = process.env.ATLAS_HOSTED_MODEL || "gpt-4.1-mini";
/* One round is one model turn, and the tools it calls in that turn. Four was
   enough while every request was one narrowing: it is not enough for a
   request that misses the vocabulary, corrects itself, sorts, shows, and then
   still has to say what it did. Running out does not fail the work, but it
   replaces the answer with "I hit my step limit", which reads as a fault. */
const HOSTED_ROUNDS = 6;
const ROUNDS = IS_HOSTED_READ_ONLY ? HOSTED_ROUNDS : 6;
/* How much of the field one turn can carry, in either direction. The library
   is under a thousand images, so this is a runaway guard rather than a page
   size: anything lower silently shrinks the canvas every time the agent
   re-forms it. */
const FIELD_CAP = 1200;
/* words that carry no signal as tag substrings — see search_library */
const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "these", "those",
  "are", "was", "were", "has", "have", "had", "its", "his", "her", "their",
  "any", "all", "not", "but", "our", "your", "out", "into", "onto", "about",
  "some", "more", "most", "very", "just", "like", "then", "than", "them",
]);

/*
  Two backs for the same agent. Groq is the house model; Claude is here for
  when Groq's free tier is spent, which on a busy day it is. The tool list,
  the vocabulary gate and the WORKING SET below belong to neither -- only
  the shape of one model call differs, so the agent behaves the same either
  way and nothing downstream knows which one answered.

  Pick with ATLAS_AGENT_PROVIDER=anthropic|groq; with it unset, whichever
  key is present wins, Groq first.
*/
type Provider = "anthropic" | "openai" | "groq";
function provider(): Provider {
  const want = (process.env.ATLAS_AGENT_PROVIDER || "").toLowerCase();
  if (want === "anthropic" || want === "openai" || want === "groq") return want;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

/* Groq speaks OpenAI's chat-completions dialect, so those two share a loop
   and differ only in where it points and what it is allowed to send.
   reasoning_format is Groq's own and OpenAI rejects it; the tiny max_tokens
   exists because Groq bills the reservation against its per-minute ceiling
   and OpenAI does not, so OpenAI gets room to actually answer. */
function openAiish(p: Provider) {
  const groq = p === "groq";
  return {
    endpoint: groq ? ENDPOINT : OPENAI_ENDPOINT,
    model: groq ? MODEL : IS_HOSTED_READ_ONLY ? HOSTED_MODEL : OPENAI_MODEL,
    key: (groq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY) ?? "",
    maxTokens: groq ? 200 : 1200,
    extra: groq ? { reasoning_format: "hidden" } : {},
  };
}

/*
  The Discovery agent: a small tool-calling loop over the library's own
  primitives. The model narrows an implicit WORKING SET with local tools
  (zero vision tokens), re-forms the field, and stages folder changes as a
  PROPOSAL — nothing is written here; /api/agent/apply commits after the
  human accepts.
*/

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_library",
      description: "Free-text search across titles, keyterms, artists, descriptions and text read from the images. REPLACES the working set with the matches.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "search words, comma separated is fine" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "filter_by_terms",
      description: "Narrow the current working set by keyterms (exact vocabulary terms). match 'all' (default) keeps images carrying EVERY term; match 'any' keeps images carrying AT LEAST ONE; match 'none' keeps images carrying NONE of them. Use 'any' whenever the human offers alternatives — 'X or Y', 'either', a list of eras — and always for two values of the same facet (two periods, two works, two carriers): no image holds two, so 'all' finds nothing there by definition. Use 'none' for exclusions: 'not X', 'without X', 'everything except X'.",
      parameters: {
        type: "object",
        properties: {
          terms: { type: "array", items: { type: "string" } },
          match: { type: "string", enum: ["all", "any", "none"] },
        },
        required: ["terms"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expand_similar",
      description: "Grow the working set by adding the most visually similar images to what is already in it (local fingerprints).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "show_field",
      description: "Re-form the canvas around the current working set so the human sees it. Call this whenever the set changes meaningfully.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "sort_field",
      description: "Arrange the canvas as a sorted GRID, read top to bottom. by='colour' sweeps the hue wheel (dark to bright inside each band); by='light' runs dark to bright. by='period' arranges decade bands from the period keyterms (earliest first, undated last); by='kind' arranges work-type lanes (photographs, posters, spreads, screens). by='off' drops the grid and puts the field back in its original order WITHOUT changing which images are on it: that is the answer to unsort, undo the sort, put it back, or original order. Use whenever the human asks to sort, arrange, order or grid the canvas. No search needed first if they mean everything showing.",
      parameters: {
        type: "object",
        properties: { by: { type: "string", enum: ["colour", "light", "period", "kind", "off"] } },
        required: ["by"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "release_field",
      description: "Put the WHOLE library back on the canvas, clearing both the narrowing and any sort. Use whenever the human asks to see everything again, start over, reset, undo the filter or release the field. Do NOT answer that with search_library: an empty search returns a capped page, not the library. If they only want the GRID undone and the current set kept, that is sort_field with by='off', not this.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_folder",
      description: "STAGE a proposal to create a folder and file the current working set into it. Does not write anything; the human accepts or rejects.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "folder name, short and evocative" },
          note: { type: "string", description: "one-line reason" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_outside",
      description: "Search the CONNECTED outside sources (museums, image platforms) for images that are NOT in the library. These APIs are keyword search over CATALOGUE TEXT: a probe finds only works whose titles or records carry the word, so a mood or theme is a PLAN of several probes, not one query. Probe three registers: direct synonyms (melancholy, sorrow, mourning, solitude); iconography and genre terms catalogues actually use (vanitas, memento mori, lamentation, elegy, deposition); and the movements and named artists known for it (for melancholy: Munch, Picasso blue period, Caspar David Friedrich, Hammershøi, Hopper, Symbolist). Each call sweeps every connected source at once — NEVER repeat the same query per source, and never the same query twice — EXCEPT to continue it: repeating a query with more:true pulls the NEXT chunk past everything it has already delivered, this turn or any earlier one (the server keeps the odometer; you never manage offsets). Set medium when the human names a kind of work: 'paintings about sorrow' without it returns vases whose descriptions mention grief. Results are CANDIDATES: shown to the human in the conversation, never in the working set, nothing written. Report the keepable count honestly — it is how many carry a licence permitting a copy.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "ONE concrete probe: words a museum catalogue would actually contain" },
          medium: { type: "string", enum: ["painting", "print", "photograph", "sculpture"], description: "facet filter on what the work IS; set it whenever the human names a kind" },
          source: { type: "string", description: "ONLY to re-check a single source id (met, artic, cleveland, rijks, arena…); omit to sweep all — the default and almost always right" },
          count: { type: "integer", minimum: 1, maximum: 240, description: "set ONLY when the human named a number of images: the TOTAL they asked for this turn. Repeat the SAME total on every probe of the turn — never the remainder still missing" },
          more: { type: "boolean", description: "continue this query past everything it has already delivered — this turn or any earlier one. The server keeps the per-source odometer; sources report exhausted when their well is dry. Use when the human asks for more / the next chunk / to pull everything." },
        },
        required: ["query"],
      },
    },
  },
];

/* Three ceilings, because a hunt has three moods.

   A PREVIEW is a look: enough to judge whether the hunt is pointed the right
   way, small enough to read without scrolling. A PULL is a decision already
   made — the human has seen the preview and wants the material — so it moves
   a real chunk, bounded by what the slowest source can actually deliver
   inside one request (the Met costs a round trip per object). The STRIP is
   the absolute: past a thousand the light table is a warehouse, and nobody
   is looking at image 900.

   The point of the split is that the agent never has to guess how much the
   human wants. It shows a preview, says what exists behind it, and waits. */
const CANDIDATE_CAP = 40;
const PULL_CHUNK = 120;
const STRIP_MAX = 1000;
/* Per PROBE. The old shape was a flat 4 per source — a QUOTA, which assumed
   the sources yield evenly. They do not, and the miss was not close: a hunt
   for a mood draws almost nothing from the Met's catalogue text while Are.na
   holds it by the thousand ("sad": ~1,600 across its matched channels,
   measured). The even split starved exactly the source that answers, and a
   three-probe hunt could not clear a dozen before overlap — the session
   that provoked this landed on eight.

   So the target is per PROBE, not per source: every source may bring up to
   the whole target (a LIMIT now, not a quota — sources with little return
   little), and the merged sweep is trimmed back to the target round-robin
   across the sources that answered, so a fat source deepens a thin probe
   but can never crowd the others off the strip. */
const OUTSIDE_PROBE_TARGET = 12;
const OUTSIDE_SINGLE_LIMIT = 12;
/* per source on a deliberate pull — deeper than a preview, still inside what
   the slowest source will serve without refusing */
const OUTSIDE_PULL_LIMIT = 24;

/* What past hunts already learned, folded into the Historian's briefing.
   The ledger is written at every probe (recordEvent below); this is the
   re-reading — the agent starts from its own record instead of
   rediscovering the same dead words every session. Empty in the read-only
   builds, and silent when there is nothing yet to say. */
function probeLedgerBrief(): string {
  const mem = probeMemory();
  if (!mem.rich.length && !mem.dry.length) return "";
  const rich = mem.rich.length
    ? "probes that YIELDED before: " + mem.rich.map((p) => p.q + " (+" + p.added + ")").join(", ") + "."
    : "";
  const dry = mem.dry.length
    ? " Probes that came back EMPTY twice or more: " + mem.dry.join(", ") + " — do not lead with these."
    : "";
  return "\n- Your own record from past hunts: " + rich + dry +
    " Reuse the registers that worked; spend the probes the record has not tried.";
}

/* the agent picks filter terms from THIS list; guessing was how a hunt for
   "deep rich colours" zeroed its own working set four times in a row */
let vocabCache: { text: string; at: number } | null = null;
function vocabulary(): string {
  if (vocabCache && Date.now() - vocabCache.at < 60_000) return vocabCache.text;
  const rows = db().prepare(
    "SELECT t.name, t.kind, COUNT(it.image_id) AS c FROM tags t " +
    "JOIN image_tags it ON it.tag_id = t.id " +
    "WHERE t.kind IN ('subject','style','mood','medium','color','format') " +
    "GROUP BY t.id HAVING c > 0 ORDER BY t.kind, c DESC"
  ).all() as { name: string; kind: string; c: number }[];
  const byKind = new Map<string, string[]>();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    const list = byKind.get(r.kind)!;
    list.push(r.name); // ordered by frequency already: the count would cost tokens for nothing
  }
  /* the people in the library. 200+ artists is too much to ship every round,
     so the agent gets the ones it will actually be asked for, and is told that
     search_library reaches the rest through the credit on each image. */
  const artists = db().prepare(
    "SELECT t.name, COUNT(it.image_id) AS c FROM tags t JOIN image_tags it ON it.tag_id = t.id " +
    "WHERE t.kind = 'artist' GROUP BY t.id ORDER BY c DESC LIMIT 45"
  ).all() as { name: string; c: number }[];

  const text = "(each list runs most-common first)\n" +
    [...byKind].map(([k, list]) => k + ": " + list.join(", ")).join("\n") +
    "\nartist (the " + artists.length + " most present, of many): " + artists.map((a) => a.name).join(", ");
  vocabCache = { text, at: Date.now() };
  return text;
}

const VOCAB_LIST = () => (db().prepare(
  "SELECT DISTINCT t.name FROM tags t JOIN image_tags it ON it.tag_id = t.id"
).all() as { name: string }[]).map((r) => r.name);

const VOCAB_SET = () => new Set(VOCAB_LIST());

/*
  The vocabulary is a controlled list, so a near miss is common and cheap to
  recover from: the archive files posters under "poster text", and a human who
  says "posters" should not be told that the whole library matches. Naming the
  term they nearly said lets the agent correct itself inside the same turn.
*/
function nearestTerms(word: string, vocab: string[]): string[] {
  const w = word.toLowerCase().trim();
  if (!w) return [];
  const parts = w.split(/s+/);
  return vocab
    .filter((v) => {
      const t = v.toLowerCase();
      if (t.includes(w) || w.includes(t)) return true;
      return parts.some((p) => p.length > 3 && t.split(/s+/).some((q) => q.startsWith(p) || p.startsWith(q)));
    })
    .slice(0, 5);
}

const SYSTEM = [
  "You are Atlas's Discovery agent, working inside a personal image archive.",
  "You narrow an implicit WORKING SET with tools; results report counts and samples.",
  "Rules:",
  "- Use tools rather than guessing. Never invent counts.",
  "- Search FIRST; filters only narrow an existing working set.",
  "- After narrowing to something worth seeing, call show_field so the canvas re-forms.",
  "- sort_field arranges whatever is showing into a sorted grid; it is the answer to sort/arrange/order/grid requests.",
  "- release_field puts the whole library back and drops any narrowing; it is the answer to everything again / reset / start over / show it all. Never answer that with a search.",
  "- Category-like requests (photography, posters, book spreads, paintings, the 1960s) are filter_by_terms even when the exact word is not in the vocabulary: the filter resolves everyday aliases itself, and tells you what it substituted. search_library is for names, phrases and free text, not categories.",
  "- If the human asked to file, collect or organize, stage it with propose_folder — never claim you created anything yourself.",
  "- To FIND an artist's work, search_library(their name) FIRST: it reads the credit on every image and reaches artists not listed below. Artist names also work inside filter_by_terms, but only to narrow a set you already have.",
  "- If the human's word is NOT in the vocabulary, you do not know whether the archive holds it. Either search_library for that exact word and report what comes back, or name the term you used instead and stop there: 'watercolour is not a term here; the nearest is painterly — 56 images'. NEVER say a substituted term covers, includes, contains, or is made up of the human's word. That is a claim about their library, and you have not looked.",
  "- Every reply that changes the field states the resulting COUNT in digits. The number is the deliverable; 'a wide range of works' is not.",
  "- There is no duplicates scanner in this conversation. For doubles, point to REMOVE DUPLICATES in the sidebar — and never present a sort as a duplicates method.",
  "- Exporting to disk is not done here either, but it EXISTS: point to the folder's Save… button (or /save). Never claim exports are impossible, and never suggest Copy log for files.",
  "- 'X or Y' is ONE filter_by_terms call with both terms and match: 'any' — never two calls and never picking one. Two values of the same facet (two periods, two works) are ALWAYS alternatives. 'not X' / 'without X' is match: 'none'.",
  "- filter_by_terms accepts ONLY terms from the KEYTERM VOCABULARY below, verbatim. Translate the human's words into the nearest vocabulary terms (e.g. 'deep rich colours' -> colorful, dark; 'moodboard for product photography' -> photography, still life, object).",
  "- Never repeat a tool call that just failed with the same arguments. If a filter matches nothing, try DIFFERENT vocabulary terms or simply show what the search found.",
  "- A decent set you can show beats a perfect set you cannot. When in doubt, show_field.",
  "- Finish with ONE short, human reply (max 2 sentences) stating concretely what you did and what the field now shows.",
  "- Never end with an open offer like 'let me know if you want more'. The interface presents next steps itself; just state the outcome.",
  "- If the human asks to save, export or log the CONVERSATION: the panel already does it — the 'Copy log' control beside Clear copies the whole chat as markdown, tool calls and finds included, and works everywhere (the hosted archive too, because it writes nothing to the server). Say exactly that. Never claim a log is impossible.",
].join("\n");

type ToolLogRow = { tool: string; args: Record<string, unknown>; result: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    {
      messages?: ChatMsg[]; field?: number[]; historian?: boolean; mute?: string[];
      /* the hunt's odometer, echoed back by the client between turns:
         query → source → how many that source has already delivered for it.
         This is what lets "pull 40 more" continue where delivery stopped
         instead of re-reading page one — the client holds it because the
         server holds nothing between requests. */
      continuation?: Record<string, Partial<Record<string, number>>>;
      /* how many candidates the light table ALREADY shows. The server keeps
         nothing between requests, so without this a pull would report "the
         strip now holds 46" at a table the human can see holds 82 — and the
         thousand-candidate ceiling would reset every turn. */
      stripHeld?: number;
      /* WHICH candidates it shows: "source:remoteId" per tile.
         The count alone was not enough to be honest with. Different queries
         return overlapping material — "sad" and "mourning" share objects —
         so a pull could hand back items the table already had, and a server
         counting its own take reported 104 at a table holding 100 (measured).
         With the identities, the dedupe happens where the material arrives:
         the count is exact, and the chunk is entirely new rather than
         partly spent on repeats. */
      stripKeys?: string[];
      /* The keyterms standing on the field right now. The field ids already
         arrive narrowed by these, so the agent has always been working
         inside them — it simply could not SEE them, and so could not say
         why a search came back with eleven. Three narrowings intersect on
         this surface (keyterms, the search box, and whatever the agent last
         put on the field); this is the one the agent was blind to. */
      filters?: string[];
    } | null;
  if (Array.isArray(body?.messages) && body.messages.some(
    (m: unknown) => !m || typeof (m as { role?: unknown }).role !== "string"
      || typeof (m as { content?: unknown }).content !== "string"
  )) {
    return Response.json({ error: "every message needs a string role and string content" }, { status: 400 });
  }
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }
  const chosen = provider();
  if (chosen === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  }
  const wire = openAiish(chosen);
  if (chosen !== "anthropic" && !wire.key) {
    return Response.json({ error: (chosen === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY") + " is not set" }, { status: 500 });
  }

  const conn = db();

  /* The working set is rebuilt per request, so it has to arrive with the
     request: the field the human is looking at IS the set that "these",
     "them" and "what is showing" refer to. Before this, only a turn that
     searched had a set at all, and "file these" staged a folder of nothing. */
  let ws: { id: number; title: string }[] = [];
  /* False while ws is only the field the client sent, true once a tool has
     actually narrowed it. show_field leans on this: re-forming the canvas
     around a set nobody narrowed is a no-op, and must never be allowed to
     truncate the field down to a page of itself. */
  let narrowed = false;
  const seed = Array.isArray(body.field)
    ? body.field.map(Number).filter(Number.isInteger).slice(0, FIELD_CAP)
    : [];
  if (seed.length) {
    const ph = seed.map(() => "?").join(",");
    const rows = conn.prepare(
      "SELECT id, ai_title, filename FROM images WHERE id IN (" + ph + ")"
    ).all(...seed) as { id: number; ai_title: string | null; filename: string }[];
    const title = new Map(rows.map((r) => [r.id, (r.ai_title || r.filename).slice(0, 40)]));
    // the field's own order is the set's order
    ws = seed.filter((id) => title.has(id)).map((id) => ({ id, title: title.get(id)! }));
  }
  /* the turn's candidate ceiling: CANDIDATE_CAP by default, or exactly the
     number the human named — the largest count any probe carried */
  let capThisTurn = CANDIDATE_CAP;
  let wantThisTurn = 0;
  /* every probe this turn, with what it actually yielded: the ledger the
     model reads back at each decision point, so "try different words" can
     become "these words are spent, that register is dry" */
  const probeLog: Array<{ q: string; found: number; added: number }> = [];
  /* the odometer: per query, per source, how many are already delivered —
     seeded from the client's echo so a pull that spans turns still counts
     from where the last one stopped. Updated after every probe, more or
     not, so the FIRST pull's yield is already on the clock when the human
     asks for the next chunk. */
  /* what the light table already shows, so this turn's arithmetic is about
     the table the human is looking at rather than about this request */
  const standingFilters = Array.isArray(body.filters)
    ? body.filters.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 24)
    : [];
  const stripKeys = Array.isArray(body.stripKeys)
    ? body.stripKeys.filter((k): k is string => typeof k === "string").slice(0, STRIP_MAX)
    : [];
  const stripHeld = stripKeys.length
    ? stripKeys.length
    : Math.max(0, Math.min(STRIP_MAX, Math.trunc(Number(body.stripHeld)) || 0));
  const consumed: Record<string, Partial<Record<string, number>>> = {};
  if (body.continuation && typeof body.continuation === "object") {
    for (const [cq, per] of Object.entries(body.continuation)) {
      if (!per || typeof per !== "object") continue;
      const clean: Partial<Record<string, number>> = {};
      for (const [src, cn] of Object.entries(per)) {
        const v = Math.max(0, Math.min(5000, Math.trunc(Number(cn)) || 0));
        if (v > 0) clean[src] = v;
      }
      if (Object.keys(clean).length) consumed[String(cq).slice(0, 200)] = clean;
    }
  }
  const out: {
    shownIds: number[] | null;
    proposal: { name: string; note: string; ids: number[]; exists: boolean } | null;
    sort: { by: "colour" | "light" | "period" | "kind" | "off" } | null;
    release: boolean;
    /* what search_outside found this turn: shown in the conversation, never
       on the canvas — candidates have no image id and no place in ws.
       totals: per source, the LARGEST population any probe this turn
       matched there — "at least this much exists", never a sum of
       overlapping probes. */
    candidates: { query: string; items: Candidate[]; totals?: Record<string, number>; pulled?: boolean } | null;
  } = { shownIds: null, proposal: null, sort: null, release: false, candidates: null };
  const toolLog: ToolLogRow[] = [];

  /* The sources the agent may reach this turn, fixed per request. On the
     hosted archive listConnections reports exactly the keyless open
     collections -- no credential of the owner's is reachable there, because
     none is stored there -- so a visitor may search museums but can never
     ride an account that is not theirs.

     The Historian lens is a SETTING: a request that says historian: false
     has switched it off in Agents, and the tool is genuinely withdrawn for
     the turn, not hidden client-side. */
  const historianOff = body.historian === false;
  /* Sources the reader switched off in Connections. On the hosted archive
     that switch is the only one they have — nothing connects there — so the
     preference arrives with the request and the source is genuinely dropped
     from the sweep, not merely hidden from the page. */
  const muted = new Set(Array.isArray(body.mute) ? body.mute.map(String) : []);
  const outsideSources = historianOff
    ? []
    : listConnections().filter((c) => c.status !== "off" && !muted.has(c.id)).map((c) => c.id);

  const sample = () => ws.slice(0, 4).map((r) => r.title).join(", ");

  /* async because search_outside genuinely goes to the network; every other
     case is a local SQLite query and returns on the same tick as before */
  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "search_library": {
        const q = String(args.query ?? "").slice(0, 200);
        /* union of the text search AND keyterm-name matches, word by word —
           the vocabulary is where most of the signal lives */
        const found = new Map<number, string>();
        const { rows } = listImages({ q, limit: 400, sort: "newest" });
        rows.forEach((r) => found.set(r.id, (r.ai_title || r.filename).slice(0, 40)));
        const words = q.toLowerCase().split(/[,\s]+/)
          .filter((w) => w.length > 2 && !SEARCH_STOPWORDS.has(w)).slice(0, 6);
        for (const w of words) {
          const trows = conn.prepare(
            "SELECT DISTINCT i.id, i.ai_title, i.filename FROM image_tags it " +
            "JOIN tags t ON t.id = it.tag_id JOIN images i ON i.id = it.image_id " +
            "WHERE (' ' || t.name || ' ') LIKE ? LIMIT 400"
          ).all("% " + w + " %") as { id: number; ai_title: string | null; filename: string }[];
          for (const r of trows) {
            if (found.size >= 400) break;
            if (!found.has(r.id)) found.set(r.id, (r.ai_title || r.filename).slice(0, 40));
          }
        }
        ws = [...found].map(([id, title]) => ({ id, title }));
        narrowed = true;
        return JSON.stringify({ count: ws.length, sample: sample() });
      }
      case "filter_by_terms": {
        const asked = (Array.isArray(args.terms) ? args.terms : [])
          .map((t) => String(t).toLowerCase())
          .map((t) => canonical(t)?.name ?? t)
          .slice(0, 6);
        if (!asked.length) return JSON.stringify({ count: ws.length, note: "no terms given" });
        /* An empty working set means nobody has searched yet. Refusing with
           "nothing to filter" is technically true and practically useless: the
           human asked for the images carrying these terms, and the library is
           the obvious place to take them from. Seeding from it here also stops
           the whole turn depending on whether the model remembered to search
           first, which is exactly the instruction a smaller model drops. */
        if (!ws.length) {
          const { rows } = listImages({ limit: 4000, sort: "newest" });
          ws = rows.map((r) => ({ id: r.id, title: (r.ai_title || r.filename).slice(0, 40) }));
        }
        /* only real vocabulary narrows; made-up words are named, not obeyed */
        const vocab = VOCAB_SET();
        const terms = asked.filter((t) => vocab.has(t));
        const unknown = asked.filter((t) => !vocab.has(t));
        if (!terms.length) {
          const vlist = VOCAB_LIST();
          const suggest: Record<string, string[]> = {};
          for (const u of unknown) { const near = nearestTerms(u, vlist); if (near.length) suggest[u] = near; }
          const hasSuggestion = Object.keys(suggest).length > 0;
          return JSON.stringify({
            count: ws.length, matched: 0, unknown,
            ...(hasSuggestion ? { did_you_mean: suggest } : {}),
            note: hasSuggestion
              ? "none of these are vocabulary terms, so the set is unchanged. Call filter_by_terms again with the terms listed under did_you_mean."
              : "none of these are vocabulary terms; the set is unchanged. Pick terms from the KEYTERM VOCABULARY.",
          });
        }
        /* "any" is a union, "none" an exclusion, "all" an intersection — the
           same query, differing in how many of the asked terms an image must
           carry and in which side of that line survives. The UI learned the
           union half of this the hard way (#80): values of a single-valued
           facet are alternatives, and demanding both of a period pair is not
           a narrow ask but an impossible one. The agent had the identical
           blindness plus no exclusion at all, so "not photography" could only
           be faked — and was, inverted. */
        const mode = args.match === "any" && terms.length > 1 ? "any"
          : args.match === "none" ? "none" : "all";
        const ids = ws.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        const tph = terms.map(() => "?").join(",");
        const rows = conn.prepare(
          "SELECT it.image_id AS id, COUNT(DISTINCT t.name) AS n FROM image_tags it " +
          "JOIN tags t ON t.id = it.tag_id WHERE it.image_id IN (" + ph + ") AND t.name IN (" + tph + ") " +
          "GROUP BY it.image_id HAVING n >= ?"
        ).all(...ids, ...terms, mode === "all" ? terms.length : 1) as { id: number }[];
        const hit = new Set(rows.map((r) => r.id));
        if (mode === "none") {
          const before = ws.length;
          ws = ws.filter((r) => !hit.has(r.id));
          narrowed = true;
          return JSON.stringify({ count: ws.length, excluded: before - ws.length, terms, match: "none", unknown, sample: sample() });
        }
        const keep = hit;
        /* a miss reports itself instead of destroying the set */
        if (!keep.size) {
          /* Which of them would have worked alone. "Try fewer" is advice; a
             count per term is the answer. */
          const each: Record<string, number> = {};
          for (const t of terms) {
            const row = conn.prepare(
              "SELECT COUNT(DISTINCT it.image_id) AS n FROM image_tags it JOIN tags tg ON tg.id = it.tag_id " +
              "WHERE it.image_id IN (" + ph + ") AND tg.name = ?"
            ).get(...ids, t) as { n: number } | undefined;
            each[t] = row?.n ?? 0;
          }
          return JSON.stringify({
            count: ws.length, matched: 0, terms, unknown, each,
            note: "no image carries ALL of these at once, so the set is unchanged. each is how many images IN THE CURRENT SET carry each term on its own — not a library-wide count, so never say a term matches nothing in the library from this. If the human meant alternatives (X or Y), call filter_by_terms again with the SAME terms and match: 'any' to take their union; otherwise call again with just the one you want.",
          });
        }
        ws = ws.filter((r) => keep.has(r.id));
        narrowed = true;
        return JSON.stringify({ count: ws.length, terms, match: mode, unknown, sample: sample() });
      }
      case "expand_similar": {
        if (!ws.length) return JSON.stringify({ count: 0, added: 0, note: "nothing to grow from: search or filter first." });
        const before = ws.length;
        const ids = ws.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        /* Enough edges to reach past the set itself. A flat 200 meant a set of
           334 could spend the entire result on links it already held. */
        const edgeLimit = Math.min(4000, Math.max(400, ids.length * 4));
        const rows = conn.prepare(
          "SELECT a_id, b_id FROM similarity WHERE (a_id IN (" + ph + ") OR b_id IN (" + ph + ")) ORDER BY score DESC LIMIT " + edgeLimit
        ).all(...ids, ...ids) as { a_id: number; b_id: number }[];
        const have = new Set(ids);
        for (const r of rows) {
          for (const cand of [r.a_id, r.b_id]) {
            /* The ceiling was a flat 300, below an ordinary working set:
               widening a set of 334 added nothing, returned a count, and the
               agent reported that it had widened. */
            if (!have.has(cand) && ws.length < FIELD_CAP) {
              const t = conn.prepare("SELECT ai_title, filename FROM images WHERE id = ?").get(cand) as { ai_title: string | null; filename: string } | undefined;
              if (t) { have.add(cand); ws.push({ id: cand, title: (t.ai_title || t.filename).slice(0, 40) }); }
            }
          }
        }
        const added = ws.length - before;
        if (added > 0) narrowed = true;
        return JSON.stringify({
          count: ws.length, added,
          ...(added === 0 ? { note: "nothing similar sits outside this set already. Say it could not be widened rather than implying it grew." } : {}),
        });
      }
      case "show_field": {
        /* Nothing has narrowed the set, so this is the field the human is
           already looking at. Pinning it would replace "everything" with a
           page of everything and report that as a re-form. Say so instead. */
        if (!narrowed) {
          return JSON.stringify({
            shown: ws.length,
            note: "that set is already what is on the canvas, so there was nothing to re-form. If they asked to see everything, call release_field.",
          });
        }
        out.shownIds = ws.slice(0, FIELD_CAP).map((r) => r.id);
        return JSON.stringify({
          shown: out.shownIds.length,
          ...(ws.length > FIELD_CAP ? { of: ws.length, note: "the canvas shows the first " + FIELD_CAP + "; tell them the set is larger" } : {}),
        });
      }
      case "release_field": {
        /* Not show_field over an empty set: that reports a capped PAGE of the
           library, and the canvas would settle on 200 of 926 while the human
           was told they were looking at everything. Releasing is the client
           dropping its narrowing entirely, so the field goes back to whatever
           the pool actually is. */
        ws = [];
        narrowed = false;
        out.release = true;
        out.shownIds = null;
        return JSON.stringify({ released: true, note: "the whole library is back on the canvas" });
      }
      case "sort_field": {
        const by = (["colour", "light", "period", "kind", "off"] as const).find((v) => v === args.by) ?? "light";
        out.sort = { by };
        return JSON.stringify(by === "off"
          ? { sorted: "off", note: "the grid is gone and the field is back in its own order; the same images are still on it" }
          : { sorted: by });
      }
      case "propose_folder": {
        /* staging an empty folder wastes the human's one accept */
        if (!ws.length) {
          return JSON.stringify({ staged: false, count: 0, note: "the working set is empty, so there is nothing to file. Search or show a set first, then propose." });
        }
        const proposedName = String(args.name ?? "Untitled").slice(0, 60);
        const proposedSlug = proposedName.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
        const taken = conn.prepare("SELECT id FROM collections WHERE slug = ? AND parent_id IS NULL")
          .get(proposedSlug) as { id: number } | undefined;
        out.proposal = {
          name: proposedName,
          note: String(args.note ?? "").slice(0, 160),
          ids: ws.slice(0, FIELD_CAP).map((r) => r.id),
          exists: !!taken,
        };
        return JSON.stringify({
          staged: true, count: out.proposal!.ids.length, exists: !!taken,
          ...(taken ? { note: "a folder with this name already exists: accepting ADDS these images to it (nothing is removed). Say so plainly; offer a different name only if the human seems to want a new folder." } : {}),
        });
      }
      case "search_outside": {
        if (!outsideSources.length) {
          return JSON.stringify({
            error: historianOff
              ? "the Historian lens is switched off in Agents, so outside search is retired this turn. Say so; do not retry."
              : "no outside sources are connected. Tell the human to connect one under Agents → Connections.",
          });
        }
        const q = String(args.query ?? "").slice(0, 200).trim();
        if (!q) return JSON.stringify({ error: "a query is required" });
        const only = outsideSources.find((id) => id === args.source) ?? null;
        const medium = MEDIUMS.find((m) => m === args.medium) ?? null;
        /* "i want 100 images" is a legitimate ask: count raises both the
           per-probe depth and the turn's cap toward the number the human
           actually named, bounded at 240 so a typo cannot order a museum. */
        const want = Math.max(0, Math.min(240, Math.trunc(Number(args.count)) || 0));
        /* The turn's ask is the LARGEST count any probe carried: a model
           that sends the remainder ("40, then 12 more") must not shrink the
           ceiling below what is already held — measured: that made the
           contract itself announce "reached" at 28 of 40. And a named
           number is the EXACT ceiling: "I want 40" must not mean 48 because
           the default cap happened to be higher (also measured). */
        if (want) wantThisTurn = Math.max(wantThisTurn, want);
        if (wantThisTurn) capThisTurn = Math.min(STRIP_MAX, wantThisTurn);
        /* a continuation pull: same query, next chunk. The odometer knows
           per source how much this query has already delivered — across
           turns, via the client's echo — and each source resumes from ITS
           own mark. A pull with no number still moves a real chunk, on top
           of whatever the strip already holds. */
        const isMore = args.more === true;
        /* The odometer is keyed on the query AND the facet, because those
           together are what define the result set an offset counts into.
           Keyed on the query alone, a pull that also narrowed by medium
           resumed at a mark counted against the UNFILTERED list and skipped
           the whole first page of the narrowed one — measured against the
           Met: all nine top-ranked "sad" paintings, gone, silently, and not
           recoverable by pulling further. A different facet is a different
           well; it starts at the top. */
        const odo = q + " " + (medium ?? "");
        const offsets = isMore ? (consumed[odo] ?? {}) : {};
        if (isMore && !wantThisTurn) {
          /* a chunk on top of this turn's own take, and never past the
             ceiling counting what the table already shows */
          capThisTurn = Math.max(0, Math.min(STRIP_MAX - stripHeld, (out.candidates?.items.length ?? 0) + PULL_CHUNK));
        }
        /* A pull goes deeper per source than a preview does — that is the
           whole difference between a look and a delivery. Not unboundedly:
           the Met costs a round trip per object and answers 403 when leaned
           on (measured), so 24 is a chunk that arrives inside one request
           rather than an order the source refuses. */
        const per = only
          ? Math.min(40, wantThisTurn || (isMore ? OUTSIDE_PULL_LIMIT : OUTSIDE_SINGLE_LIMIT))
          : Math.min(40, wantThisTurn
              ? Math.ceil(wantThisTurn / Math.max(1, outsideSources.length))
              : isMore ? OUTSIDE_PULL_LIMIT : OUTSIDE_PROBE_TARGET);

        const { results: fetched, searched, failed, totals, exhausted, consumed: advanced } = await searchConnected(q, {
          limit: per,
          only,
          medium,
          offsets,
          /* the turn's own gate, not the database's: a source the reader
             switched off must not be reached by re-deriving the live list */
          allow: outsideSources,
        });

        /* the round-robin trim: every source that answered is represented,
           and the surplus goes to whoever actually had the goods. A pull
           skips it — a deliberate chunk is delivered whole. */
        let results = fetched;
        if (!only && !wantThisTurn && !isMore && fetched.length > OUTSIDE_PROBE_TARGET) {
          const lanes = new Map<string, Candidate[]>();
          for (const c of fetched) {
            const lane = lanes.get(c.source);
            if (lane) lane.push(c); else lanes.set(c.source, [c]);
          }
          const mixed: Candidate[] = [];
          for (let i = 0; mixed.length < OUTSIDE_PROBE_TARGET; i++) {
            let reached = false;
            for (const lane of lanes.values()) {
              if (i < lane.length) {
                reached = true;
                mixed.push(lane[i]);
                if (mixed.length >= OUTSIDE_PROBE_TARGET) break;
              }
            }
            if (!reached) break;
          }
          results = mixed;
        }

        /* Accumulate across the turn's probes: the strip the human sees is
           the union, deduped by identity, capped so it stays a strip. */
        const held = out.candidates?.items ?? [];
        const before = held.length;
        /* Does this turn ADD to the table or REPLACE it? The client merges
           only what is marked pulled, so everything downstream — the dedupe
           seed and the count quoted to the human — has to ask the same
           question. A new hunt inherits neither: its tiles are about to be
           swept away, so counting them makes the agent say 55 at a table
           showing 19 (measured), and skipping them would under-deliver a
           fresh hunt to avoid repeating material nobody will see again. */
        const pulledTurn = isMore || out.candidates?.pulled === true;
        const seen = new Set([
          ...(pulledTurn ? stripKeys : []),
          ...held.map((c) => c.source + ":" + c.remoteId),
        ]);
        const delivered: Partial<Record<string, number>> = {};
        for (const c of results) {
          if (held.length >= capThisTurn) break;
          const key = c.source + ":" + c.remoteId;
          if (!seen.has(key)) {
            seen.add(key); held.push(c);
            delivered[c.source] = (delivered[c.source] ?? 0) + 1;
          }
        }
        const added = held.length - before;
        /* The odometer moves by each source's OWN cursor, not by what
           reached the strip. Those differ in two places and both matter: an
           ID the Met read but could not illustrate still advanced its list,
           and the preview trim below can withhold items that were
           nonetheless fetched. Crediting only what was shown left the cursor
           behind and re-served the same objects on the next chunk —
           measured. The cost is that a trimmed item is skipped rather than
           re-offered, which against populations in the thousands is
           invisible; a repeat is not. */
        {
          const slot = (consumed[odo] = consumed[odo] ?? {});
          for (const a of advanced) if (a.consumed > 0) slot[a.source] = (slot[a.source] ?? 0) + a.consumed;
        }
        /* a source is only dry once it has ALSO stopped delivering: an
           adapter that reports exhausted while still handing over a full
           chunk is describing its page, not its well */
        const dryNow = exhausted.filter((s) => !delivered[s]);
        /* the label joins DISTINCT probes: a per-source sweep calls this five
           times with one query, and "melancholy" five times over is not a
           title, it is a stutter */
        const probes = new Set(out.candidates ? out.candidates.query.split(", ") : []);
        probes.add(q);
        /* per source, keep the LARGEST matched population any probe saw:
           "at least N exists there" — summing probes would double-count */
        const heldTotals: Record<string, number> = out.candidates?.totals ?? {};
        for (const t of totals) {
          if (t.total == null) continue;
          heldTotals[t.source] = Math.max(heldTotals[t.source] ?? 0, t.total);
        }
        /* pulled marks a CONTINUATION turn: the client must merge this
           onto what it already shows rather than replace it, or a pull would
           cost the human the preview they were pulling from */
        out.candidates = { query: [...probes].join(", "), items: held, totals: heldTotals, pulled: isMore || out.candidates?.pulled === true };

        const perSource: Record<string, number> = {};
        for (const c of results) perSource[c.source] = (perSource[c.source] ?? 0) + 1;
        const matched: Record<string, number> = {};
        for (const t of totals) if (t.total != null) matched[t.source] = t.total;
        const totalMatched = Object.values(matched).reduce((a, b) => a + b, 0);
        probeLog.push({ q, found: results.length, added });
        /* the diary: what this probe asked and what it yielded, durable, so
           the NEXT session's hunt can start from what this one learned */
        recordEvent("historian", "probe", {
          q, sources: searched.length, found: results.length, added,
          matched: totalMatched || null,
        });
        /* What is left out there: the population the sources reported, less
           everything this query has already handed over. Approximate by
           construction — the populations are, and channels hold text as well
           as images — so it is spoken as "about", never as a promise. */
        const takenSoFar = Object.values(consumed[odo] ?? {}).reduce((a: number, b) => a + (b ?? 0), 0);
        const remaining = Math.max(0, totalMatched - takenSoFar);
        const allDry = searched.length > 0 && dryNow.length >= searched.length;

        /* The loop contract, spoken at the decision point.

           It used to drive toward a quota: probe, probe, probe until the
           number is met. That is the right shape for "find me 40" and the
           wrong shape for everything else — it made the agent grind through
           registers on its own judgement while the human, who knows what
           they actually want, sat watching.

           So the default is now a PREVIEW that ends in a HAND-BACK. Two or
           three probes build a look worth judging, then the agent stops,
           says what it found and what exists behind it, and offers the fork:
           refine, pull more, or leave it there. No auto-grinding, no
           quota-chasing, and no asking permission it does not need — the
           preview is already on the table when the question is asked. */
        const registersLeft =
          "the registers are synonyms, then iconography (vanitas, lamentation, elegy), then the movements and named artists — move to the register the ledger shows untried";
        const scale = totalMatched
          ? "The sources report about " + totalMatched.toLocaleString("en-GB") + " matching this theme"
            + (remaining > 0 ? ", roughly " + remaining.toLocaleString("en-GB") + " of it not yet pulled" : "")
            + ". "
          : "";
        /* the hand-back, in two halves so it composes either as an
           instruction on its own or as the tail of "one more probe, then …" */
        const handBackTail =
          "reply. Say plainly what is on the light table and " +
          (totalMatched ? "about how much exists behind it" : "that the sources do not report a total") +
          ", then offer the choice in ONE short sentence: refine the hunt, pull more, or leave it as it is. " +
          "Offer — do not push, do not ask twice, do not list steps. If they say nothing more, the preview stands on its own.";
        const handBack = "STOP probing and " + handBackTail;
        /* the table as the HUMAN sees it: this turn's take on top of what was
           already showing */
        const onTable = (pulledTurn ? stripHeld : 0) + held.length;

        const next = isMore
          ? (allDry
            ? "every source is out of material for this query. Say so plainly, say how many were pulled in total, and suggest a DIFFERENT angle rather than more of this one."
            : added === 0
              ? "that pull returned nothing new — this query is spent even though the sources report more. Say so, and offer a different wording or a refinement instead of pulling again."
              : "pulled " + added + " more; the light table now holds " + onTable + ". " + scale
                + "Reply now with what arrived. If material clearly remains, mention that another pull is available — once, plainly.")
          : wantThisTurn
            ? (held.length >= wantThisTurn
              ? "the asked number is reached — STOP probing and reply now."
              : added === 0
                ? "that probe added NOTHING new (" + held.length + " of " + wantThisTurn + " gathered). " + registersLeft + "; try ONE more, then reply with what you have."
                : "gathered " + held.length + " of the " + wantThisTurn + " asked. Run ANOTHER probe NOW with different words (count stays " + wantThisTurn + ") — never repeat: " + [...probes].join(", ") + ". Keep going until you approach " + wantThisTurn + " or the probes run dry.")
            : (added === 0
              ? "that probe added NOTHING new. " + registersLeft + "; if the last two probes both added nothing, " + handBack
              : probeLog.length >= 3 || held.length >= CANDIDATE_CAP
                ? "the preview is ready (" + onTable + " on the table). " + scale + handBack
                : "run one or two more probes from a different register to make the preview representative, then " + handBackTail);
        return JSON.stringify({
          query: q,
          searched: searched.length,
          found: results.length,
          keepable: results.filter((c) => c.keepable).length,
          per_source: perSource,
          /* the population behind the preview: what the sources SAY the
             query matched, so the reply can be honest about scale */
          matched_at_sources: matched,
          total_matched: totalMatched || undefined,
          sample: results.slice(0, 4).map((c) => c.title).join(", "),
          gathered_this_turn: held.length,
          on_light_table: onTable,
          /* the turn's own ledger, probe by probe: yield is the teacher */
          probes_this_turn: probeLog.map((p) => p.q + " → +" + p.added),
          ...(failed.length ? { failed } : {}),
          /* the loop contract, spoken AT the decision point: a system rule
             asking for persistence was followed 1 time in 5 (measured); an
             instruction inside the tool result is read when it matters */
          ...(wantThisTurn ? { asked_for: wantThisTurn } : {}),
          /* the pull's own arithmetic, so the reply can be specific about
             scale without the model inventing a number */
          already_pulled_for_this_query: takenSoFar,
          about_remaining: totalMatched ? remaining : undefined,
          ...(dryNow.length ? { sources_out_of_material: dryNow } : {}),
          /* against the table the human is looking at, not this turn's take:
             a full strip cannot take more however little this request got */
          can_pull_more: !allDry && (remaining > 0 || totalMatched === 0) && onTable < STRIP_MAX,
          next,
          note: "candidates appear to the human on the light table beside the conversation. They are NOT in the library and NOT on the canvas. found is only the bounded preview; matched_at_sources is what actually exists — when it dwarfs found, SAY SO (e.g. \"showing 16 of ~3,400 at the Met\") so the human knows the hunt only skimmed the surface. To pull the next chunk, call this tool again with the SAME query and more:true — never re-run a query without more:true expecting different results.",
        });
      }
      default:
        return JSON.stringify({ error: "unknown tool" });
    }
  }

  type LoopMsg =
    | { role: "system" | "user" | "assistant"; content: string }
    | { role: "assistant"; content: string | null; tool_calls: unknown[] }
    | { role: "tool"; tool_call_id: string; content: string };

  /* without this the model searches from scratch every turn and throws away
     the very set the human just asked it to act on */
  const holding = ws.length
    ? "\n\nThe human is looking at a field of " + ws.length + " image" + (ws.length === 1 ? "" : "s") +
      ", and that field IS your working set already. \"these\", \"them\", \"what is showing\" and \"the current set\" all mean exactly those images: filter, sort, show or propose over them directly. Search again only if they are plainly asking for something new."
    : "";

  /* On the hosted archive it can look but not write, and it should say so
     itself rather than leave the interface apologising afterwards. */
  const hosted = IS_HOSTED_READ_ONLY
    ? "\n\nThis is the public, read-only archive. You can search, filter, widen and re-form the field, and that is genuinely useful. You CANNOT file a folder, tag anything, or change the archive in any way, and you have no tool for it. If the human asks you to file, save, tag or organise into folders, say plainly that the hosted archive is read-only and that running the project locally is where those work. Do not apologise at length, and do not offer it as a next step."
    : "";

  /* The outside tool is spoken about only when it exists. A model told about
     a tool it was not given will try to call it anyway; a model given a tool
     with no guidance will use it for requests the library already answers. */
  const outside = outsideSources.length
    ? "\n\nsearch_outside is the HISTORIAN lens: it reaches these connected sources: " + outsideSources.join(", ") +
      ". Use it ONLY when the human asks for images beyond the library — new material, museums, 'find more like this from outside'. " +
      "The library always comes first for anything it can answer. Candidates are not in the library: never file, sort or count them as if they were." +
      "\n- Outside hunts for a MOOD or THEME are a plan of 3 to 5 DIFFERENT probes, because catalogues only match their own words. Probe the synonyms, the iconography (vanitas, lamentation, elegy), and the movements and artists art history files under that mood — a hunt for melancholy that never probes Munch, the Symbolists or Picasso's blue period has only searched the word, not the subject." +
      "\n- One probe sweeps every source at once. Never issue the same query twice, and never once-per-source." +
      "\n- When the human names a kind of work (paintings, prints, photographs), set medium on every probe." +
      "\n- When the human asks to PULL from, SEE, or SHOW the outside sources, SEARCH — immediately, with the conversation's current theme if they named none. Never describe what a search could do instead of running one." +
      "\n- Probes are catalogue queries, not sentences: two or three words each. Fold a refinement's tones and colours into SEPARATE short probes ('dark melancholy', 'blue grief'), never one long string — a compound string matches nothing anywhere." +
      "\n- Are.na's wealth for a mood is its CHANNELS — human-curated collections someone already spent an evening filling ('sad' surfaces channels holding ~1,600 blocks). A probe walks the matched channels for you; probe with the short evocative words a person would NAME a channel (sad, melancholy, grief, longing, blue), not catalogue phrases. matched_at_sources now reports Are.na's real population — when it dwarfs found, the hunt has only skimmed and should probe again." +
      "\n- A zero-result probe is information — loosen the words and try once more before concluding a source holds nothing." +
      "\n- When the human names ONE source (are.na, the Met), set source on every probe so the hunt goes only there — never sweep everything and report a subset." +
      "\n- When the human names a NUMBER of images, set count to it on every probe and keep probing with DIFFERENT words until gathered_this_turn approaches it or the probes run dry. Never refuse a number; gather toward it." +
      "\n- A hunt with no number is a PREVIEW, not a delivery. Two or three probes, then STOP and hand back: say what is on the light table, about how much exists behind it, and offer in ONE sentence to refine, pull more, or leave it. The preview is already there when you ask — so ask once, lightly, and never re-ask. If they say nothing about it, the preview was the answer." +
      "\n- \"More\", \"keep going\", \"pull the rest\", \"all of them\" = the SAME query again with more:true. That continues past everything already delivered; it never re-reads what they have seen. Never answer a request for more by inventing new words — that is a different hunt, and it loses their place." +
      "\n- When a refinement lands, check it against what they asked for before pulling deeper: if the narrowed preview drifted off what they meant, say so and offer the previous wording back. A refinement that missed is a normal event, not a failure — going back one step must always be on the table, and must cost them one sentence." +
      "\n- Never pull a large chunk unasked, and never make them ask twice. can_pull_more in the tool result says whether material remains; sources_out_of_material says who is finished. When everything is dry, say so and suggest a different angle rather than offering another pull." +
      "\n- A probe's query must NEVER be empty. If the human named no subject, probe the conversation's standing theme; with none at all, probe broad catalogue staples (portrait, landscape, still life) — never blanks or filler." +
      "\n- Candidates can NEVER be filed into a folder — propose_folder files LIBRARY images only, and acquiring outside finds into the library is not built yet ANYWHERE, the local build included. If asked to keep or file candidates: gather them onto the light table, say filing outside finds is not possible yet, and point at Copy log as the record. Never imply another build or place could file them." +
      probeLedgerBrief()
    : historianOff
      ? "\n\nThe Historian lens is switched off in Agents, so you have no outside-search tool this turn. If the human asks to search museums or outside platforms, say the Historian is switched off and where the switch lives."
      : IS_HOSTED_READ_ONLY
      ? "\n\nOutside sources (museum and platform search) are a local-runtime capability and are not available on this hosted archive. If the human asks to search museums or outside platforms, say that plainly."
      : "\n\nNo outside source is connected, and you have no tool for reaching one. If the human asks to search museums or outside platforms, say so plainly and point them to Agents → Connections.";

  /* What the human has pinned by hand, spoken to the agent.

     Three narrowings intersect on this surface — these keyterms, the search
     box, and whatever the agent last put on the field — and the field ids
     arrive already cut by all three. So the agent has always been answering
     inside the filters; it just could not see them, which is why "only
     eleven?" had no answer it could give. Naming them lets the count be
     explained instead of merely reported, and lets the agent offer the one
     move that would widen the result. */
  const standing = standingFilters.length
    ? "\n\nSTANDING FILTERS the human has pinned on the field: " + standingFilters.join(", ") +
      ".\n- Everything on the field is INSIDE these, and so is every count you quote. They are ANDed: an image must carry all of them." +
      "\n- When a result comes back small or empty, say which of these narrowed it before offering anything else — that is usually the whole explanation, and it is invisible to the human until you say it." +
      "\n- They are the human's own choice, not an obstacle. Never remove one on your own. When lifting one would plainly open up what they are asking for, name it and offer — once." +
      "\n- A search for something these exclude will return nothing NO MATTER how it is worded. Say that rather than re-searching."
    : "";

  const system = SYSTEM + hosted + holding + standing + outside + "\n\nKEYTERM VOCABULARY (term(count)):\n" + vocabulary();
  const turns = body.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  /* Nothing on the hosted archive can be written, so propose_folder is not
     offered there: the accept it leads to would be refused by the middleware.
     search_outside is offered only when a source is actually connected --
     and never hosted, where outbound calls would spend the host's quota on
     anonymous traffic. One list, used by BOTH provider paths: the Anthropic
     loop mapping the unfiltered constant is how a tool escapes its gate. */
  const tools = TOOLS.filter((t) => {
    if (t.function.name === "propose_folder") return !IS_HOSTED_READ_ONLY;
    if (t.function.name === "search_outside") return outsideSources.length > 0;
    return true;
  });

  const msgs: LoopMsg[] = [{ role: "system", content: system }, ...turns];

  /*
    The same loop against the Messages API. The tool schemas are the ones
    above, re-shaped: OpenAI nests them under .function, Anthropic takes
    name/description/input_schema flat. Results come back as tool_result
    blocks in a user turn rather than as their own role.
  */
  async function runClaude(): Promise<string> {
    const client = new Anthropic({ timeout: 90_000 });
    /* the FILTERED list, not the constant: both provider paths must offer
       exactly the same tools or the gates above only guard one of them */
    const claudeTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));
    const messages: Anthropic.MessageParam[] = turns.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    for (let round = 0; round < ROUNDS; round++) {
      const res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system,
        tools: claudeTools,
        /* the job is picking two or three tools off a list of six, so the
           cheap, fast end of the effort scale is the right one here */
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages,
      });

      if (res.stop_reason === "refusal") {
        throw new Error("the model declined this request" + (res.stop_details && "explanation" in res.stop_details ? ": " + res.stop_details.explanation : ""));
      }

      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!calls.length) {
        return res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
      }

      /* the whole assistant turn goes back, thinking blocks included:
         dropping them breaks multi-turn continuity on the same model */
      messages.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const c of calls) {
        const args = (c.input ?? {}) as Record<string, unknown>;
        let result: string;
        try {
          result = await runTool(c.name, args);
        } catch (err) {
          result = JSON.stringify({ error: (err instanceof Error ? err.message : "tool failed").slice(0, 120) });
        }
        toolLog.push({ tool: c.name, args, result });
        results.push({ type: "tool_result", tool_use_id: c.id, content: result });
      }
      /* every result rides in ONE user turn: splitting them teaches the
         model to stop calling tools in parallel */
      messages.push({ role: "user", content: results });
    }
    return "";
  }

  try {
    if (provider() === "anthropic") {
      const reply = await runClaude();
      if (out.shownIds === null && !out.proposal && narrowed && ws.length) {
        out.shownIds = ws.slice(0, FIELD_CAP).map((r) => r.id);
        toolLog.push({ tool: "show_field", args: {}, result: JSON.stringify({ shown: out.shownIds.length, auto: true }) });
      }
      return Response.json({
        reply: reply || (out.shownIds?.length
          ? "I hit my step limit, but the " + out.shownIds.length + " I gathered are on the field."
          : "I hit my step limit before finding anything worth showing. Try different words."),
        toolLog,
        ids: out.shownIds ?? out.proposal?.ids ?? null,
        proposal: out.proposal,
        sort: out.sort,
        /* release was missing from this return for as long as the two paths
           existed, which made release_field a silent no-op on Anthropic */
        release: out.release,
        candidates: out.candidates,
        /* the hunt odometer, handed back for the client to echo next turn —
           the only reason a pull can continue across turns at all */
        continuation: consumed,
      });
    }

    let reply = "";
    for (let round = 0; round < ROUNDS; round++) {
      const res = await fetch(wire.endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + wire.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: wire.model,
          max_tokens: wire.maxTokens,
          temperature: 0.2,
          ...wire.extra,
          tools,
          tool_choice: "auto",
          messages: msgs,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const t = await res.text();
        if (/per day|TPD/i.test(t)) throw new Error("The daily model quota is reached — try again later.");
        /* the retry-after is the useful half of a rate-limit error and it
           sits past 160 characters, so keep it when it is there */
        const when = t.match(/try again in ([0-9hms.]+)/i);
        throw new Error("model call failed: " + t.slice(0, 160) + (when ? " … retry in " + when[1] : ""));
      }
      const data = await res.json() as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
      const m = data.choices?.[0]?.message;
      if (!m) throw new Error("empty completion");

      if (m.tool_calls?.length) {
        msgs.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
        for (const tc of m.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leave empty */ }
          let result: string;
          try {
            result = await runTool(tc.function.name, args);
          } catch (err) {
            result = JSON.stringify({ error: (err instanceof Error ? err.message : "tool failed").slice(0, 120) });
          }
          toolLog.push({ tool: tc.function.name, args, result });
          msgs.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }
      reply = (m.content ?? "").trim();
      break;
    }
    /* the model may run out of rounds without calling show_field: a working
       set it built still lands on the field rather than evaporating */
    if (out.shownIds === null && !out.proposal && narrowed && ws.length) {
      out.shownIds = ws.slice(0, FIELD_CAP).map((r) => r.id);
      toolLog.push({ tool: "show_field", args: {}, result: JSON.stringify({ shown: out.shownIds.length, auto: true }) });
    }
    if (!reply) {
      reply = out.shownIds?.length
        ? "I hit my step limit, but the " + out.shownIds.length + " I gathered are on the field."
        : "I hit my step limit before finding anything worth showing. Try different words.";
    }
    return Response.json({
      reply, toolLog,
      ids: out.shownIds ?? out.proposal?.ids ?? null,
      proposal: out.proposal, sort: out.sort, release: out.release,
      candidates: out.candidates,
      continuation: consumed,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "agent failed" }, { status: 502 });
  }
}
