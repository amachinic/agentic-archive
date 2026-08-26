import { db } from "@/lib/db";
import { promptToTerms, VisionError, type ChatMsg } from "@/lib/vision";

export const maxDuration = 120;

/*
  Prompt discovery: free text -> the model picks matching keyterms from the
  archive's own vocabulary (plus likely title/description words) -> images are
  scored locally. Keyterm hits weigh most; title/description hits next; raw
  generation-prompt and filename hits least. Conversation history refines.
*/
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { messages?: ChatMsg[] } | null;
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }
  const history = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  const conn = db();
  const vocab = (conn.prepare("SELECT name FROM tags ORDER BY name").all() as { name: string }[]).map((r) => r.name);

  try {
    const t = await promptToTerms(history, vocab);
    const termSet = new Set(t.terms);

    const rows = conn.prepare(
      "SELECT id, filename, ai_title, ai_description, prompt_text, ocr_text FROM images"
    ).all() as { id: number; filename: string; ai_title: string | null; ai_description: string | null; prompt_text: string | null; ocr_text: string | null }[];
    const tagRows = conn.prepare(
      "SELECT it.image_id, t.name FROM image_tags it JOIN tags t ON t.id = it.tag_id"
    ).all() as { image_id: number; name: string }[];
    const tagsByImage = new Map<number, string[]>();
    for (const r of tagRows) {
      (tagsByImage.get(r.image_id) ?? tagsByImage.set(r.image_id, []).get(r.image_id)!).push(r.name);
    }

    const scored: { id: number; score: number }[] = [];
    for (const img of rows) {
      let score = 0;
      for (const tag of tagsByImage.get(img.id) ?? []) {
        if (termSet.has(tag)) score += 3;
      }
      const title = (img.ai_title ?? "").toLowerCase();
      const desc = (img.ai_description ?? "").toLowerCase();
      const gen = (img.prompt_text ?? "").toLowerCase();
      const fname = img.filename.toLowerCase();
      const ocr = (img.ocr_text ?? "").toLowerCase();
      for (const w of t.words) {
        if (title.includes(w)) score += 2;
        if (desc.includes(w)) score += 2;
        if (ocr.includes(w)) score += 2;   // words READ FROM the image itself
        if (gen.includes(w)) score += 1;
        if (fname.includes(w)) score += 1;
      }
      if (score > 0) scored.push({ id: img.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const ids = scored.map((s) => s.id);

    const analyzed = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE ai_at IS NOT NULL").get() as { n: number }).n;
    const localTagged = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE local_at IS NOT NULL").get() as { n: number }).n;
    let reply = t.reply + " " + (ids.length ? ids.length + " match" + (ids.length === 1 ? "" : "es") + "." : "Nothing matched.");
    // only warn about coverage when NEITHER indexing pass has reached most of the library
    if (analyzed < rows.length / 2 && localTagged < rows.length / 2) {
      reply += " (Much of the library is un-indexed; run npm run tag-local for instant local coverage.)";
    }

    return Response.json({ ids, terms: t.terms, words: t.words, reply });
  } catch (e) {
    const status = e instanceof VisionError ? 502 : 500;
    return Response.json({ error: e instanceof Error ? e.message : "prompt search failed" }, { status });
  }
}
