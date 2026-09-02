import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, now, LIBRARY_DIR } from "./db";
import { canonical, vocabularyBlock, facetBlock, TAXONOMY } from "./taxonomy";

/* ============================================================
   Groq vision. This account has no Llama-4 multimodal access, so the model is
   a reasoning model: `reasoning_format: "hidden"` keeps the <think> pass out of
   the content, which is what makes strict JSON parsing safe. Groq also throws
   503 "over capacity" on this model fairly often, so every call goes through
   the same bounded retry with exponential backoff and jitter.
   Swap the model by setting GROQ_VISION_MODEL.
   ============================================================ */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
/* The catalogue pass can ride OpenAI instead: Groq's free tier caps the day
   at 200k tokens and a full 925-image pass needs roughly ten times that.
   Opt in per process with ATLAS_VISION_PROVIDER=openai -- the backlog runner
   sets it; interactive single-image analysis stays on the house model. */
const OAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OAI_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
const USE_OAI = process.env.ATLAS_VISION_PROVIDER?.trim() === "openai";
// Text-only work rides a separate model with its OWN rate bucket, so prompt
// discovery never competes with image analysis for tokens-per-minute.
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";

export class VisionError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "VisionError";
  }
}

type Msg = {
  role: "system" | "user" | "assistant";
  content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
};

async function chat(messages: Msg[], maxTokens = 3600, retries = 6, json = true, effort?: "none" | "low", model = MODEL): Promise<string> {
  const oai = USE_OAI;
  const key = oai ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY;
  if (!key) throw new VisionError((oai ? "OPENAI_API_KEY" : "GROQ_API_KEY") + " is not set. Add it to .env.local");

  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(oai ? OAI_ENDPOINT : ENDPOINT, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: oai ? OAI_MODEL : model,
          max_tokens: maxTokens,
          temperature: json ? 0.3 : 0.5,
          /* reasoning_format / reasoning_effort are Groq dialect */
          ...(oai ? {} : { reasoning_format: "hidden" }),
          ...(!oai && effort ? { reasoning_effort: effort } : {}),
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(backoff(attempt));
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (content) return content;
      lastErr = "empty completion";
      await sleep(backoff(attempt));
      continue;
    }

    const body = await res.text();
    lastErr = body.slice(0, 300);

    // Daily-quota exhaustion is NOT worth retrying: surface it immediately so
    // callers (the backlog runner especially) can wait out the rolling window
    // instead of burning a minute of blind retries.
    if (/per day|TPD/i.test(body)) {
      const m = body.match(/try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)?s/i);
      let eta = "later today";
      if (m) {
        const mins = (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0) + Math.ceil((Number(m[3]) || 0) / 60);
        eta = mins >= 60 ? "in ~" + Math.floor(mins / 60) + "h " + (mins % 60) + "m" : "in ~" + Math.max(1, mins) + " min";
      }
      throw new VisionError("The daily analysis quota has been reached · retry " + eta, res.status);
    }
    // 429 / 5xx are transient on this model. 4xx other than 429 will not fix
    // itself, so fail fast rather than burning the retry budget.
    // json_validate_failed is a sampling flake on this reasoning model: retrying
    // with the same prompt usually lands. Everything else 4xx is a real bug.
    const transient = res.status === 429 || res.status >= 500 || /capacity|json_validate_failed/i.test(body);
    if (!transient) throw new VisionError("Groq " + res.status + ": " + lastErr, res.status);
    await sleep(backoff(attempt));
  }
  throw new VisionError("Groq unavailable after " + (retries + 1) + " attempts. Last error: " + lastErr);
}

function backoff(attempt: number) {
  // 1s, 2s, 4s, 8s ... capped, plus jitter so parallel jobs do not resonate.
  return Math.min(1000 * 2 ** attempt, 20_000) + Math.random() * 600;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Reasoning models occasionally wrap the object in prose. Recover the
    // outermost balanced braces rather than discarding a good response.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new VisionError("Model did not return JSON: " + cleaned.slice(0, 200));
  }
}

/** Downscale before upload: the model gains nothing from 4k, and it costs latency. */
async function encodeImage(relPath: string, maxSide = 768) {
  const abs = path.join(LIBRARY_DIR, relPath);
  const buf = await sharp(abs, { failOn: "none" })
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return "data:image/jpeg;base64," + buf.toString("base64");
}

export type Analysis = {
  title: string;
  description: string;
  subjects: string[];
  style: string[];
  mood: string[];
  /* the archival facets: what the work IS, how it reached this file, when it
     dates from, what it is made of, how it was made. See lib/taxonomy.ts. */
  work: string;
  carrier: string;
  period: string;
  materials: string[];
  processes: string[];
  period_evidence: string;
  /* pre-facet analyses stored this; kept so old JSON still types */
  medium?: string;
  material: string;
  lighting: string;
  aesthetic: string;
  technique: string;
  historical_context: string;
  artist_reference: string;
  time_period: string;
  composition: string;
  color_reading: string;
  critique: string;
  differentiation: string;
};

const ANALYSIS_SYSTEM = `You are an archivist and art director cataloguing a visual reference archive.
Look at the image and answer with ONLY a JSON object, no prose around it, with exactly these keys:
{
  "title": "short evocative name, max 6 words",
  "description": "two or three sentences describing what is actually visible",
  "subjects": ["categories from the SUBJECT vocabulary below"],
  "style": ["categories from the STYLE vocabulary below"],
  "mood": ["categories from the MOOD vocabulary below"],
  "work": "ONE value from WORK: what the work IS, not how it was captured",
  "carrier": "ONE value from CARRIER: how the work reached this file",
  "period": "ONE value from PERIOD: the decade the work was most likely CREATED",
  "materials": ["0 to 2 values from MATERIAL: what the work is made of or printed on"],
  "processes": ["0 to 2 values from PROCESS: the making process, only when readable from the surface"],
  "period_evidence": "the concrete evidence behind the period call: a printed date, a process, dress, typography, a device on screen. 'none' when the period is undated",
  "material": "the physical or simulated materials and surfaces present and how they read, one sentence",
  "lighting": "the light: apparent source, direction, quality, contrast, one sentence",
  "aesthetic": "the aesthetic lineage or movement this sits in, one sentence",
  "technique": "how it appears to have been made: process, tooling, printing, rendering, one sentence",
  "historical_context": "historical or cultural reference points this connects to, one or two sentences",
  "artist_reference": "artists, studios or practitioners whose work this evokes, phrased as resemblance not attribution, one sentence",
  "time_period": "the era or decade the visual language belongs to, e.g. 1960s swiss modernism, one short phrase",
  "composition": "one sentence on framing, balance and where the eye lands",
  "color_reading": "one sentence on the palette and how it carries the image",
  "critique": "one or two sentences: what is working, and what is weak or unresolved. Be specific and honest, not flattering.",
  "differentiation": "one concrete suggestion for how to push this further from the obvious version of itself"
}
Use lowercase for every array entry.
KEYTERM RULES. Every entry in subjects, style and mood MUST be copied verbatim from this vocabulary:
${vocabularyBlock()}
Pick only what genuinely applies (2 to 5 per array; fewer is better than forced). If nothing in a list fits, return an empty array. NEVER invent a term, never combine two, never add adjectives: a phrase true of only this one image belongs in the description, not in a keyterm. The description is searched, so detail is not lost.

FACET RULES. work, carrier, period, materials and processes MUST be copied verbatim from:
${facetBlock()}
The work is what the thing IS, never how it was captured. A photograph of an open book is a "book spread"; a photograph of a poster on a wall is a "poster"; a product shot of a sneaker is a "photograph" only if the photograph itself is the work -- when the file exists to reproduce or document some other work, name THAT work. "photograph" is reserved for images where the photograph is the work: a photographer's frame, a portrait, a street scene, an art photograph.
The carrier says how the work got here: "direct" when the file IS the work (native digital design, a photographer's own frame), "photographed" when a physical work was photographed (book spreads, posters on walls, product and documentation shots), "scanned" for flatbed reproductions, "screen captured" for screenshots of screens.
The period is when the work was CREATED, judged from evidence -- a printed date, the process, dress, typography, devices. A contemporary design in a 1960s style is 2010s or 2020s, not 1960s. Answer "undated" when the evidence is not there, and say so in period_evidence.
work, carrier and period must NEVER be empty and never a word outside their lists: when none fits exactly, pick the nearest listed value. A photographic portrait or figure study is "photograph". A hardback seen from outside is "book cover"; open pages are "book spread". Physical things -- sculpture, buildings, garments, products -- are never work values: they are subjects, and an image that exists to show one is "photograph" when the photograph has its own authorship, or "artwork reproduction" when the file is purely a record of another artwork. Anything created before 1900 is "pre-1900".`;

export async function analyzeImage(imageId: number): Promise<Analysis> {
  const conn = db();
  const row = conn.prepare("SELECT rel_path, prompt_text FROM images WHERE id = ?").get(imageId) as
    { rel_path: string; prompt_text: string | null } | undefined;
  if (!row) throw new VisionError("Image " + imageId + " not found");

  const dataUrl = await encodeImage(row.rel_path);
  const hint = row.prompt_text
    ? "\n\nFor context, the generation prompt was:\n" + row.prompt_text.slice(0, 900)
    : "";

  const content = await chat([
    { role: "system", content: ANALYSIS_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: "Catalogue this image." + hint },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ], 4400);

  const a = parseJson<Analysis>(content);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((s) => String(s).trim().toLowerCase()) : []);
  /* a facet answer is either on its controlled list or it is nothing */
  const facet = (v: unknown, kind: keyof typeof TAXONOMY) => {
    const n = String(v ?? "").trim().toLowerCase();
    return TAXONOMY[kind].includes(n) ? n : "";
  };
  const facets = (v: unknown, kind: keyof typeof TAXONOMY, max: number) =>
    arr(v).filter((n) => TAXONOMY[kind].includes(n)).slice(0, max);
  const clean: Analysis = {
    title: String(a.title ?? "").trim() || "Untitled",
    description: String(a.description ?? "").trim(),
    subjects: arr(a.subjects),
    style: arr(a.style),
    mood: arr(a.mood),
    work: facet(a.work, "work"),
    carrier: facet(a.carrier, "carrier"),
    period: facet(a.period, "period"),
    materials: facets(a.materials, "material", 2),
    processes: facets(a.processes, "process", 2),
    period_evidence: String(a.period_evidence ?? "").trim(),
    material: String(a.material ?? "").trim(),
    lighting: String(a.lighting ?? "").trim(),
    aesthetic: String(a.aesthetic ?? "").trim(),
    technique: String(a.technique ?? "").trim(),
    historical_context: String(a.historical_context ?? "").trim(),
    artist_reference: String(a.artist_reference ?? "").trim(),
    time_period: String(a.time_period ?? "").trim(),
    composition: String(a.composition ?? "").trim(),
    color_reading: String(a.color_reading ?? "").trim(),
    critique: String(a.critique ?? "").trim(),
    differentiation: String(a.differentiation ?? "").trim(),
  };

  conn.prepare(
    "UPDATE images SET ai_title=?, ai_description=?, ai_analysis=?, ai_model=?, ai_at=? WHERE id=?"
  ).run(clean.title, clean.description, JSON.stringify(clean), MODEL, now(), imageId);

  applyTags(imageId, clean);
  return clean;
}

/** Fold the analysis arrays into the shared tag vocabulary, marked source='ai'. */
function applyTags(imageId: number, a: Analysis) {
  const conn = db();
  const groups: [string[], string][] = [
    [a.subjects, "subject"],
    [a.style, "style"],
    [a.mood, "mood"],
    [a.work ? [a.work] : [], "work"],
    [a.carrier ? [a.carrier] : [], "carrier"],
    [a.period ? [a.period] : [], "period"],
    [a.materials ?? [], "material"],
    [a.processes ?? [], "process"],
  ];
  /* The archival facets hold ONE value per image (work, carrier, period) or
     a small current set (materials, processes): a re-catalogue must replace
     what an earlier pass wrote, or an image reclassified from "photograph"
     to "book spread" would simply carry both. Subjects, style and mood stay
     accumulative, as they always were. */
  const clearKind = conn.prepare(
    "DELETE FROM image_tags WHERE image_id = ? AND tag_id IN (SELECT id FROM tags WHERE kind = ?)"
  );
  for (const [names, kind] of groups) {
    if (["work", "carrier", "period", "material", "process"].includes(kind) && names.length) {
      clearKind.run(imageId, kind);
    }
  }
  /* a name owns exactly one kind: never let a later tagger flip it (that is
     how tall images once became "portraits") */
  const upsertTag = conn.prepare("INSERT INTO tags (name, kind) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id");
  const linkTag = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source, weight) VALUES (?,?,'ai',1)");
  /* the vocabulary is the gate: a model answer that is not a category gets
     dropped here rather than minting a keyterm only one image will ever carry.
     The kind comes from the taxonomy too, never from where the model put it. */
  for (const [names, hint] of groups) {
    for (const raw of names) {
      if (!raw || raw.length > 40) continue;
      const can = canonical(raw);
      if (!can) continue;
      /* A single-valued facet value may only arrive through its own group.
         Without this, a style word that aliases into a work term ("graphic"
         -> "graphic design") links a SECOND work value from inside the style
         list — the clear-before-write above never sees it, and the facet's
         one-value promise breaks silently. Measured before this guard: 99
         images carrying two works, 87 of them this exact rider. */
      if (["work", "carrier", "period"].includes(can.kind) && can.kind !== hint) continue;
      const t = upsertTag.get(can.name, can.kind) as { id: number } | undefined;
      if (t) linkTag.run(imageId, t.id);
    }
  }
}

/* ---- Quick tagging: the light pass that makes an image SEARCHABLE.
   ~1/3 the tokens of the full analysis (small image, no reasoning, short
   output), so the whole backlog can be worked through against the TPM cap.
   A later full analyze simply overwrites with the richer version. ---- */

const QUICK_SYSTEM = `You are cataloguing an image archive so it can be searched.
Look at the image and answer with ONLY a JSON object:
{
  "title": "short evocative name, max 6 words",
  "description": "one or two sentences describing what is visible. If the image contains text, writing, a quote, a journal page, typography or a document, SAY SO and quote a few visible words.",
  "subjects": ["categories from the SUBJECT vocabulary below"],
  "style": ["categories from the STYLE vocabulary below"],
  "mood": ["categories from the MOOD vocabulary below"],
  "work": "ONE value from the WORK list: what the work IS, not how it was captured",
  "carrier": "ONE value from the CARRIER list: how the work reached this file"
}
Use lowercase for every array entry.
KEYTERM RULES. Every entry in subjects, style and mood MUST be copied verbatim from this vocabulary:
${vocabularyBlock()}
Pick only what genuinely applies (2 to 5 per array; fewer is better than forced). If nothing in a list fits, return an empty array. NEVER invent a term, never combine two, never add adjectives: a phrase true of only this one image belongs in the description, not in a keyterm. The description is searched, so detail is not lost.
WORK: ${TAXONOMY.work.join(", ")}
CARRIER: ${TAXONOMY.carrier.join(", ")}
The work is what the thing IS: a photograph of an open book is a "book spread"; "photograph" is reserved for images where the photograph itself is the work. The carrier is "direct" when the file IS the work, "photographed" / "scanned" / "screen captured" when it reproduces one.`;

export async function quickTagImage(imageId: number): Promise<{ title: string; tags: number }> {
  const conn = db();
  const row = conn.prepare("SELECT rel_path FROM images WHERE id = ?").get(imageId) as
    { rel_path: string } | undefined;
  if (!row) throw new VisionError("Image " + imageId + " not found");

  const dataUrl = await encodeImage(row.rel_path, 448);
  const content = await chat([
    { role: "system", content: QUICK_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: "Catalogue this image." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
    /* Groq counts max_tokens toward the DAILY token estimate, so an
       over-reserved ceiling costs real quota on every image. The quick
       schema needs ~120 tokens; 420 leaves headroom without paying for
       580 tokens of air 900 times over. */
  ], 420, 4, true, "none");

  const a = parseJson<Partial<Analysis>>(content);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim().toLowerCase()) : []);
  const facet = (v: unknown, kind: keyof typeof TAXONOMY) => {
    const n = String(v ?? "").trim().toLowerCase();
    return TAXONOMY[kind].includes(n) ? n : "";
  };
  const clean = {
    title: String(a.title ?? "").trim() || "Untitled",
    description: String(a.description ?? "").trim(),
    subjects: arr(a.subjects),
    style: arr(a.style),
    mood: arr(a.mood),
    work: facet(a.work, "work"),
    carrier: facet(a.carrier, "carrier"),
  };

  conn.prepare(
    "UPDATE images SET ai_title=?, ai_description=?, ai_analysis=?, ai_model=?, ai_at=? WHERE id=?"
  ).run(clean.title, clean.description, JSON.stringify(clean), MODEL + " · quick", now(), imageId);

  applyTags(imageId, clean as Analysis);
  return { title: clean.title, tags: clean.subjects.length + clean.style.length + clean.mood.length };
}

export type Comparison = {
  verdict: string;
  shared: string[];
  differences: string[];
  stronger: "a" | "b" | "neither";
  why: string;
  how_to_diverge: string;
};

const COMPARE_SYSTEM = `You are an art director comparing two images from the same archive.
Answer with ONLY a JSON object, no prose around it:
{
  "verdict": "one sentence on how closely these two actually relate",
  "shared": ["what they genuinely have in common, 2 to 5 items"],
  "differences": ["what meaningfully separates them, 2 to 5 items"],
  "stronger": "a" | "b" | "neither",
  "why": "one or two sentences justifying the call, on craft not taste",
  "how_to_diverge": "concrete direction for pushing the weaker one somewhere the other is not"
}
Image A is given first, image B second.`;

export async function compareImages(aId: number, bId: number): Promise<Comparison> {
  const conn = db();
  const rows = conn.prepare("SELECT id, rel_path FROM images WHERE id IN (?,?)").all(aId, bId) as
    { id: number; rel_path: string }[];
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  if (!a || !b) throw new VisionError("Both images must exist");

  // This org's TPM ceiling for the model is 8000 and Groq counts max_tokens
  // toward it, so a two-image request must stay small: 448px keeps both
  // pictures plus a workable reasoning budget under the cap.
  const [ua, ub] = await Promise.all([encodeImage(a.rel_path, 448), encodeImage(b.rel_path, 448)]);
  const content = await chat([
    { role: "system", content: COMPARE_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: "Image A:" },
        { type: "image_url", image_url: { url: ua } },
        { type: "text", text: "Image B:" },
        { type: "image_url", image_url: { url: ub } },
        { type: "text", text: "Compare them." },
      ],
    },
  // Two 448px images are ~1800 prompt tokens each and the org TPM cap is 8000
  // with max_tokens counted in, so the reasoning pass is disabled here: the
  // model answers directly and the whole request stays inside the window.
  ], 2400, 6, true, "none");

  const c = parseJson<Comparison>(content);
  conn.prepare("INSERT INTO comparisons (a_id,b_id,verdict,body,model,created_at) VALUES (?,?,?,?,?,?)")
    .run(aId, bId, String(c.verdict ?? ""), JSON.stringify(c), MODEL, now());
  return c;
}

export type ChatMsg = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM = `You are an art director and visual historian inside an image archive tool.
You are discussing ONE specific image; its picture is attached to the first user message.
Ground every answer in what is actually visible. Be concrete: name materials, lighting setups,
compositional moves, historical references and lineages when relevant. Keep answers tight,
one or two short paragraphs, no filler, no flattery. Plain text, no markdown headings.`;

/** Freeform Q&A about one library image, with short conversation memory. */
export async function chatAboutImage(imageId: number, history: ChatMsg[]): Promise<string> {
  const conn = db();
  const row = conn.prepare("SELECT rel_path, ai_analysis FROM images WHERE id = ?").get(imageId) as
    { rel_path: string; ai_analysis: string | null } | undefined;
  if (!row) throw new VisionError("Image " + imageId + " not found");
  if (!history.length || history[history.length - 1].role !== "user") {
    throw new VisionError("history must end with a user message");
  }

  const dataUrl = await encodeImage(row.rel_path);
  let system = CHAT_SYSTEM;
  if (row.ai_analysis) {
    system += "\n\nCatalogued analysis of the image, for context:\n" + row.ai_analysis.slice(0, 1600);
  }

  // Keep the window small; attach the image to the FIRST user turn in it so
  // the model always has pixels in context regardless of trimming.
  const win = history.slice(-10);
  const firstUser = win.findIndex((m) => m.role === "user");
  const msgs: Msg[] = [{ role: "system", content: system }];
  win.forEach((m, i) => {
    if (i === firstUser) {
      msgs.push({
        role: "user",
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      });
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  });

  // The model leaks markdown emphasis despite instructions; the chat bubble
  // renders plain text, so strip it rather than display literal asterisks.
  return (await chat(msgs, 2600, 5, false)).replace(/\*\*|__|(?<![\w*])\*(?=\w)|(?<=\w)\*(?![\w*])/g, "").trim();
}

export type PromptTerms = { terms: string[]; words: string[]; reply: string };

const PROMPT_SYSTEM_HEAD = `You are the search brain of a personal image archive. The user describes imagery they are hunting for: an idea, a mood, a dream, an aesthetic. Translate the LATEST request (interpreting the conversation cumulatively; follow-ups refine earlier asks) into search terms.

The archive's existing keyterm vocabulary is:
`;

const PROMPT_SYSTEM_TAIL = `

Answer with ONLY a JSON object:
{
  "terms": ["up to 10 keyterms picked ONLY from the vocabulary above, closest in spirit to the request"],
  "words": ["up to 8 additional lowercase words or short fragments likely to appear in image titles or descriptions matching the request"],
  "reply": "one short sentence, spoken to the user, describing what you are hunting for on their behalf"
}`;

/** Free-text prompt -> archive search terms, via a text-only pass. */
export async function promptToTerms(history: ChatMsg[], vocabulary: string[]): Promise<PromptTerms> {
  const system = PROMPT_SYSTEM_HEAD + vocabulary.slice(0, 160).join(", ") + PROMPT_SYSTEM_TAIL;
  const msgs: Msg[] = [
    { role: "system", content: system },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) })),
  ];
  const rawResp = await chat(msgs, 900, 5, true, undefined, TEXT_MODEL);
  const p = parseJson<PromptTerms>(rawResp);
  const arr = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim().toLowerCase()).slice(0, max);
  return {
    terms: arr(p.terms, 10),
    words: arr(p.words, 8),
    reply: String(p.reply ?? "").trim() || "Searching the archive.",
  };
}

/* ---- Strict OCR-text classification: the model READS the words extracted
   from each image and assigns at most two precise classes, or none at all.
   Refinement over spray: noise, fragments and uncertainty all return []. ---- */

export const TEXT_CLASSES = [
  "quote", "poem", "philosophy", "journal", "letter", "essay", "label", "poster text", "typography",
] as const;

const CLASSIFY_SYSTEM = `You classify text that was OCR-extracted from archive images.

For EACH numbered item, decide:
- If the text is garbled OCR noise, meaningless fragments, or not coherent human language: classes = [].
- Otherwise assign AT MOST 2 classes, chosen ONLY from:
  quote        - a short standalone aphorism, saying, or cited statement
  poem         - verse, line breaks with poetic rhythm
  philosophy   - reflective conceptual prose about existence, art, society, creativity
  journal      - personal notes, diary-like or observational writing
  letter       - correspondence addressed to someone
  essay        - structured prose, article or criticism
  label        - product, catalogue, credit or caption text
  poster text  - display or title lettering: event, exhibition, album, headline wording
  typography   - the text exists primarily as a typographic or lettering specimen

BE STRICT. When unsure between something and nothing, return []. Never invent classes outside the list.
Return ONLY JSON: {"items":[{"id":123,"classes":["quote"]}, ...]} with every input id present.`;

export async function classifyTexts(items: { id: number; text: string }[]): Promise<Map<number, string[]>> {
  const user = items.map((i) => "#" + i.id + ":\n" + i.text.slice(0, 420)).join("\n\n");
  const raw = await chat(
    [{ role: "system", content: CLASSIFY_SYSTEM }, { role: "user", content: user }],
    1400, 5, true, undefined, TEXT_MODEL,
  );
  const parsed = parseJson<{ items: { id: number; classes: string[] }[] }>(raw);
  const allowed = new Set<string>(TEXT_CLASSES);
  const out = new Map<number, string[]>();
  for (const item of parsed.items ?? []) {
    if (!Number.isInteger(item.id)) continue;
    const classes = (Array.isArray(item.classes) ? item.classes : [])
      .map((c) => String(c).trim().toLowerCase())
      .filter((c) => allowed.has(c))
      .slice(0, 2);
    out.set(item.id, classes);
  }
  return out;
}

/* ---- Artist / creator identification from EVIDENCE only: the filename and
   the words inside the image. No guessing from style; null when unnamed. ---- */

const IDENTIFY_SYSTEM = `You identify the artist, designer, photographer or author behind archive images from textual evidence.

Each numbered item gives a filename and text found inside the image (OCR), sometimes a catalogue title.

Rules:
- Name a person or studio ONLY when the evidence itself contains their name (in the filename or the visible text). Expanding to the canonical form is allowed: "rodin" -> "Auguste Rodin", "Newton-WilliamBlake" -> "William Blake", "kashimoto_satoji" -> "Satoji Kashimoto".
- The name should be the work's primary attributed creator: the artist, designer, photographer, or author. Not galleries, publishers, cities, or people merely mentioned.
- NEVER infer a name from visual style or genre. No evidence, no name.
- confidence: "high" when the name is explicit and unambiguous; "medium" when the evidence strongly implies it. When lower than that, return null.

Return ONLY JSON: {"items":[{"id":12,"name":"Auguste Rodin","role":"sculptor","confidence":"high"},{"id":13,"name":null}]} with every input id present.`;

export type ArtistHit = { name: string; role: string; confidence: "high" | "medium" };

export async function identifyArtists(items: { id: number; evidence: string }[]): Promise<Map<number, ArtistHit>> {
  const user = items.map((i) => "#" + i.id + ":\n" + i.evidence.slice(0, 380)).join("\n\n");
  const raw = await chat(
    [{ role: "system", content: IDENTIFY_SYSTEM }, { role: "user", content: user }],
    1500, 5, true, undefined, TEXT_MODEL,
  );
  const parsed = parseJson<{ items: { id: number; name: string | null; role?: string; confidence?: string }[] }>(raw);
  const out = new Map<number, ArtistHit>();
  for (const item of parsed.items ?? []) {
    if (!Number.isInteger(item.id) || !item.name || typeof item.name !== "string") continue;
    const name = item.name.trim();
    const conf = item.confidence === "high" ? "high" : item.confidence === "medium" ? "medium" : null;
    if (!name || name.length > 60 || !conf) continue;
    out.set(item.id, { name, role: String(item.role ?? "").trim().toLowerCase(), confidence: conf });
  }
  return out;
}

export { MODEL as VISION_MODEL };
