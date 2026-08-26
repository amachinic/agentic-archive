import { db } from "@/lib/db";
import { listImages } from "@/lib/queries";
import type { ChatMsg } from "@/lib/vision";

export const maxDuration = 120;

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";

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
      description: "Arrange the canvas as a sorted GRID, read top to bottom. by='colour' sweeps the hue wheel (dark to bright inside each band); by='light' runs dark to bright. Use whenever the human asks to sort, arrange, order or grid the canvas. No search needed first if they mean everything showing.",
      parameters: {
        type: "object",
        properties: { by: { type: "string", enum: ["colour", "light"] } },
        required: ["by"],
      },
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
];

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

const VOCAB_SET = () => {
  const names = db().prepare(
    "SELECT DISTINCT t.name FROM tags t JOIN image_tags it ON it.tag_id = t.id"
  ).all() as { name: string }[];
  return new Set(names.map((r) => r.name));
};

const SYSTEM = [
  "You are Atlas's Discovery agent, working inside a personal image archive.",
  "You narrow an implicit WORKING SET with tools; results report counts and samples.",
  "Rules:",
  "- Use tools rather than guessing. Never invent counts.",
  "- Search FIRST; filters only narrow an existing working set.",
  "- After narrowing to something worth seeing, call show_field so the canvas re-forms.",
  "- sort_field arranges whatever is showing into a sorted grid; it is the answer to sort/arrange/order/grid requests.",
  "- If the human asked to file, collect or organize, stage it with propose_folder — never claim you created anything yourself.",
  "- To FIND an artist's work, search_library(their name) FIRST: it reads the credit on every image and reaches artists not listed below. Artist names also work inside filter_by_terms, but only to narrow a set you already have.",
  "- filter_by_terms accepts ONLY terms from the KEYTERM VOCABULARY below, verbatim. Translate the human's words into the nearest vocabulary terms (e.g. 'deep rich colours' -> colorful, dark; 'moodboard for product photography' -> photography, still life, object).",
  "- Never repeat a tool call that just failed with the same arguments. If a filter matches nothing, try DIFFERENT vocabulary terms or simply show what the search found.",
  "- A decent set you can show beats a perfect set you cannot. When in doubt, show_field.",
  "- Finish with ONE short, human reply (max 2 sentences) stating concretely what you did and what the field now shows.",
  "- Never end with an open offer like 'let me know if you want more'. The interface presents next steps itself; just state the outcome.",
].join("\n");

type ToolLogRow = { tool: string; args: Record<string, unknown>; result: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { messages?: ChatMsg[] } | null;
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }
  const key = process.env.GROQ_API_KEY;
  if (!key) return Response.json({ error: "GROQ_API_KEY is not set" }, { status: 500 });

  const conn = db();
  let ws: { id: number; title: string }[] = [];
  const out: { shownIds: number[] | null; proposal: { name: string; note: string; ids: number[] } | null; sort: { by: "colour" | "light" } | null } = { shownIds: null, proposal: null, sort: null };
  const toolLog: ToolLogRow[] = [];

  const sample = () => ws.slice(0, 4).map((r) => r.title).join(", ");

  function runTool(name: string, args: Record<string, unknown>): string {
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
        return JSON.stringify({ count: ws.length, sample: sample() });
      }
      case "filter_by_terms": {
        const asked = (Array.isArray(args.terms) ? args.terms : []).map((t) => String(t).toLowerCase()).slice(0, 6);
        if (!asked.length || !ws.length) return JSON.stringify({ count: ws.length, note: "nothing to filter" });
        /* only real vocabulary narrows; made-up words are named, not obeyed */
        const vocab = VOCAB_SET();
        const terms = asked.filter((t) => vocab.has(t));
        const unknown = asked.filter((t) => !vocab.has(t));
        if (!terms.length) {
          return JSON.stringify({ count: ws.length, matched: 0, unknown, note: "none of these are vocabulary terms; the set is unchanged. Pick terms from the KEYTERM VOCABULARY." });
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
          return JSON.stringify({ count: ws.length, matched: 0, terms, unknown, note: "no image carries ALL of these; the set is unchanged. Try fewer or different vocabulary terms, or show_field what the search found." });
        }
        ws = ws.filter((r) => keep.has(r.id));
        return JSON.stringify({ count: ws.length, terms, unknown, sample: sample() });
      }
      case "expand_similar": {
        if (!ws.length) return JSON.stringify({ count: 0 });
        const ids = ws.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        const rows = conn.prepare(
          "SELECT a_id, b_id FROM similarity WHERE (a_id IN (" + ph + ") OR b_id IN (" + ph + ")) ORDER BY score DESC LIMIT 200"
        ).all(...ids, ...ids) as { a_id: number; b_id: number }[];
        const have = new Set(ids);
        for (const r of rows) {
          for (const cand of [r.a_id, r.b_id]) {
            if (!have.has(cand) && ws.length < 300) {
              const t = conn.prepare("SELECT ai_title, filename FROM images WHERE id = ?").get(cand) as { ai_title: string | null; filename: string } | undefined;
              if (t) { have.add(cand); ws.push({ id: cand, title: (t.ai_title || t.filename).slice(0, 40) }); }
            }
          }
        }
        return JSON.stringify({ count: ws.length });
      }
      case "show_field": {
        out.shownIds = ws.slice(0, 200).map((r) => r.id);
        return JSON.stringify({ shown: out.shownIds.length });
      }
      case "sort_field": {
        out.sort = { by: args.by === "colour" ? "colour" : "light" };
        return JSON.stringify({ sorted: out.sort.by });
      }
      case "propose_folder": {
        out.proposal = {
          name: String(args.name ?? "Untitled").slice(0, 60),
          note: String(args.note ?? "").slice(0, 160),
          ids: ws.slice(0, 500).map((r) => r.id),
        };
        return JSON.stringify({ staged: true, count: out.proposal.ids.length });
      }
      default:
        return JSON.stringify({ error: "unknown tool" });
    }
  }

  type LoopMsg =
    | { role: "system" | "user" | "assistant"; content: string }
    | { role: "assistant"; content: string | null; tool_calls: unknown[] }
    | { role: "tool"; tool_call_id: string; content: string };

  const msgs: LoopMsg[] = [
    { role: "system", content: SYSTEM + "\n\nKEYTERM VOCABULARY (term(count)):\n" + vocabulary() },
    ...body.messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-10)
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    let reply = "";
    for (let round = 0; round < 6; round++) {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 450, // Groq bills the RESERVATION against TPM; the reply is 2 sentences
          temperature: 0.2,
          reasoning_format: "hidden",
          tools: TOOLS,
          tool_choice: "auto",
          messages: msgs,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const t = await res.text();
        if (/per day|TPD/i.test(t)) throw new Error("The daily model quota is reached — try again later.");
        throw new Error("model call failed: " + t.slice(0, 160));
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
            result = runTool(tc.function.name, args);
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
    if (out.shownIds === null && !out.proposal && ws.length) {
      out.shownIds = ws.slice(0, 200).map((r) => r.id);
      toolLog.push({ tool: "show_field", args: {}, result: JSON.stringify({ shown: out.shownIds.length, auto: true }) });
    }
    if (!reply) {
      reply = out.shownIds?.length
        ? "I hit my step limit, but the " + out.shownIds.length + " I gathered are on the field."
        : "I hit my step limit before finding anything worth showing. Try different words.";
    }
    return Response.json({ reply, toolLog, ids: out.shownIds ?? out.proposal?.ids ?? null, proposal: out.proposal, sort: out.sort });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "agent failed" }, { status: 502 });
  }
}
