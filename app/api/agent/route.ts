import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { listImages } from "@/lib/queries";
import { IS_HOSTED_READ_ONLY } from "@/lib/runtime";
import type { ChatMsg } from "@/lib/vision";

export const maxDuration = 120;

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
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
const HOSTED_ROUNDS = 4;
const ROUNDS = IS_HOSTED_READ_ONLY ? HOSTED_ROUNDS : 6;

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
  const body = await req.json().catch(() => null) as { messages?: ChatMsg[]; field?: number[] } | null;
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
  const seed = Array.isArray(body.field)
    ? body.field.map(Number).filter(Number.isInteger).slice(0, 500)
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
        /* staging an empty folder wastes the human's one accept */
        if (!ws.length) {
          return JSON.stringify({ staged: false, count: 0, note: "the working set is empty, so there is nothing to file. Search or show a set first, then propose." });
        }
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

  const system = SYSTEM + hosted + holding + "\n\nKEYTERM VOCABULARY (term(count)):\n" + vocabulary();
  const turns = body.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  /* Nothing here can be written, so propose_folder is not offered: the accept
     it leads to would be refused by the middleware, and an agent that stages
     something it cannot finish is worse than one that says it cannot. */
  const tools = IS_HOSTED_READ_ONLY
    ? TOOLS.filter((t) => t.function.name !== "propose_folder")
    : TOOLS;

  const msgs: LoopMsg[] = [{ role: "system", content: system }, ...turns];

  /*
    The same loop against the Messages API. The tool schemas are the ones
    above, re-shaped: OpenAI nests them under .function, Anthropic takes
    name/description/input_schema flat. Results come back as tool_result
    blocks in a user turn rather than as their own role.
  */
  async function runClaude(): Promise<string> {
    const client = new Anthropic({ timeout: 90_000 });
    const tools: Anthropic.Tool[] = TOOLS.map((t) => ({
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
        tools,
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
          result = runTool(c.name, args);
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
      if (out.shownIds === null && !out.proposal && ws.length) {
        out.shownIds = ws.slice(0, 200).map((r) => r.id);
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
