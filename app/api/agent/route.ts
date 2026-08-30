import Anthropic from "@anthropic-ai/sdk";
import { canonical } from "@/lib/taxonomy";
import { db } from "@/lib/db";
import { listImages } from "@/lib/queries";
import { IS_HOSTED_READ_ONLY } from "@/lib/runtime";
import { listConnections } from "@/lib/connections";
import { searchConnected, MEDIUMS, type Candidate } from "@/lib/sources";
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
      description: "Narrow the current working set to images carrying ALL of the given keyterms (exact vocabulary terms).",
      parameters: {
        type: "object",
        properties: { terms: { type: "array", items: { type: "string" } } },
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
      description: "Search the CONNECTED outside sources (museums, image platforms) for images that are NOT in the library. These APIs are keyword search over CATALOGUE TEXT: a probe finds only works whose titles or records carry the word, so a mood or theme is a PLAN of several probes, not one query. Probe three registers: direct synonyms (melancholy, sorrow, mourning, solitude); iconography and genre terms catalogues actually use (vanitas, memento mori, lamentation, elegy, deposition); and the movements and named artists known for it (for melancholy: Munch, Picasso blue period, Caspar David Friedrich, Hammershøi, Hopper, Symbolist). Each call sweeps every connected source at once — NEVER repeat the same query per source, and never the same query twice. Set medium when the human names a kind of work: 'paintings about sorrow' without it returns vases whose descriptions mention grief. Results are CANDIDATES: shown to the human in the conversation, never in the working set, nothing written. Report the keepable count honestly — it is how many carry a licence permitting a copy.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "ONE concrete probe: words a museum catalogue would actually contain" },
          medium: { type: "string", enum: ["painting", "print", "photograph", "sculpture"], description: "facet filter on what the work IS; set it whenever the human names a kind" },
          source: { type: "string", description: "ONLY to re-check a single source id (met, artic, cleveland, rijks, arena…); omit to sweep all — the default and almost always right" },
        },
        required: ["query"],
      },
    },
  },
];

/* How many candidates one turn may accumulate across all its probes: past
   this the strip stops informing and starts scrolling. 48 leaves room for
   three or four distinct probes to land after overlap collapses. */
const CANDIDATE_CAP = 48;
/* Per source, per call. A full sweep keeps it small so ONE probe cannot fill
   the strip and crowd out the other registers; a single-source re-check may
   go deeper. The Met costs one round trip per candidate either way. */
const OUTSIDE_SWEEP_LIMIT = 4;
const OUTSIDE_SINGLE_LIMIT = 6;

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
    { messages?: ChatMsg[]; field?: number[]; historian?: boolean } | null;
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
  const out: {
    shownIds: number[] | null;
    proposal: { name: string; note: string; ids: number[] } | null;
    sort: { by: "colour" | "light" | "period" | "kind" | "off" } | null;
    release: boolean;
    /* what search_outside found this turn: shown in the conversation, never
       on the canvas — candidates have no image id and no place in ws.
       totals: per source, the LARGEST population any probe this turn
       matched there — "at least this much exists", never a sum of
       overlapping probes. */
    candidates: { query: string; items: Candidate[]; totals?: Record<string, number> } | null;
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
  const outsideSources = historianOff
    ? []
    : listConnections().filter((c) => c.status !== "off").map((c) => c.id);

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
        const words = q.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 2).slice(0, 6);
        for (const w of words) {
          const trows = conn.prepare(
            "SELECT DISTINCT i.id, i.ai_title, i.filename FROM image_tags it " +
            "JOIN tags t ON t.id = it.tag_id JOIN images i ON i.id = it.image_id " +
            "WHERE t.name LIKE ? LIMIT 400"
          ).all("%" + w + "%") as { id: number; ai_title: string | null; filename: string }[];
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
        const ids = ws.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        const tph = terms.map(() => "?").join(",");
        const rows = conn.prepare(
          "SELECT it.image_id AS id, COUNT(DISTINCT t.name) AS n FROM image_tags it " +
          "JOIN tags t ON t.id = it.tag_id WHERE it.image_id IN (" + ph + ") AND t.name IN (" + tph + ") " +
          "GROUP BY it.image_id HAVING n = ?"
        ).all(...ids, ...terms, terms.length) as { id: number }[];
        const keep = new Set(rows.map((r) => r.id));
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
            note: "no image carries ALL of these at once, so the set is unchanged. each is how many carry each term on its own: call filter_by_terms again with just the one you want.",
          });
        }
        ws = ws.filter((r) => keep.has(r.id));
        narrowed = true;
        return JSON.stringify({ count: ws.length, terms, unknown, sample: sample() });
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
        out.proposal = {
          name: String(args.name ?? "Untitled").slice(0, 60),
          note: String(args.note ?? "").slice(0, 160),
          ids: ws.slice(0, FIELD_CAP).map((r) => r.id),
        };
        return JSON.stringify({ staged: true, count: out.proposal.ids.length });
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

        const { results, searched, failed, totals } = await searchConnected(q, {
          limit: only ? OUTSIDE_SINGLE_LIMIT : OUTSIDE_SWEEP_LIMIT,
          only,
          medium,
        });

        /* Accumulate across the turn's probes: the strip the human sees is
           the union, deduped by identity, capped so it stays a strip. */
        const held = out.candidates?.items ?? [];
        const seen = new Set(held.map((c) => c.source + ":" + c.remoteId));
        for (const c of results) {
          if (held.length >= CANDIDATE_CAP) break;
          const key = c.source + ":" + c.remoteId;
          if (!seen.has(key)) { seen.add(key); held.push(c); }
        }
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
        out.candidates = { query: [...probes].join(", "), items: held, totals: heldTotals };

        const perSource: Record<string, number> = {};
        for (const c of results) perSource[c.source] = (perSource[c.source] ?? 0) + 1;
        const matched: Record<string, number> = {};
        for (const t of totals) if (t.total != null) matched[t.source] = t.total;
        const totalMatched = Object.values(matched).reduce((a, b) => a + b, 0);
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
          ...(failed.length ? { failed } : {}),
          note: "candidates appear to the human on the light table beside the conversation. They are NOT in the library and NOT on the canvas. found is only the bounded preview; matched_at_sources is what actually exists — when it dwarfs found, SAY SO (e.g. \"showing 16 of ~3,400 at the Met\") so the human knows the hunt only skimmed the surface.",
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
      "\n- Are.na matches the words ON blocks and channels: probe it with short evocative terms. A zero-result probe is information — loosen the words and try once more before concluding a source holds nothing."
    : historianOff
      ? "\n\nThe Historian lens is switched off in Agents, so you have no outside-search tool this turn. If the human asks to search museums or outside platforms, say the Historian is switched off and where the switch lives."
      : IS_HOSTED_READ_ONLY
      ? "\n\nOutside sources (museum and platform search) are a local-runtime capability and are not available on this hosted archive. If the human asks to search museums or outside platforms, say that plainly."
      : "\n\nNo outside source is connected, and you have no tool for reaching one. If the human asks to search museums or outside platforms, say so plainly and point them to Agents → Connections.";

  const system = SYSTEM + hosted + holding + outside + "\n\nKEYTERM VOCABULARY (term(count)):\n" + vocabulary();
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
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "agent failed" }, { status: 502 });
  }
}
