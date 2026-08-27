/*
  The second opinion on "photograph".

  The catalogue pass classifies every image in one general call, and its one
  systematic residue is the user-visible one: some book spreads, posters and
  prints keep "photograph" because a camera was obviously involved. This
  sweep re-asks ONLY that question, image by image, with the strict
  definition in front of the judge -- and reclassifies the noes. A focused
  judge on one binary beats a generalist on seventeen fields.

    ATLAS_VISION_PROVIDER=openai npx tsx scripts/verify-photographs.ts
    ... --limit 20        # taste
*/
import fs from "node:fs";
import path from "node:path";
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
import sharp from "sharp";
import { db, LIBRARY_DIR } from "../lib/db";
import { TAXONOMY } from "../lib/taxonomy";
import { recordEvent } from "../lib/events";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };
const LIMIT = Number(flag("limit", "0"));
const MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY missing"); process.exit(1); }

const conn = db();
const rows = conn.prepare(
  "SELECT i.id, i.rel_path FROM images i JOIN image_tags it ON it.image_id=i.id " +
  "JOIN tags t ON t.id=it.tag_id AND t.kind='work' AND t.name='photograph' ORDER BY i.id"
).all() as { id: number; rel_path: string }[];
const todo = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
console.log("verifying " + todo.length + " images tagged work=photograph · judge " + MODEL);

const SYS = `You audit ONE classification in an image archive: is this file's WORK a photograph, or does the file exist to reproduce a DIFFERENT kind of work?

"photograph" means the photograph itself is the work: a photographer's frame -- portrait, street, landscape, still life, fashion, product shot, documentary image.

It is NOT a photograph when the file reproduces another work and that work is what matters: an open book or magazine (book spread / magazine page), a closed book (book cover), a poster, a print or zine page, a painting, a record sleeve, a screenshot, an installation or sculpture merely being recorded (artwork reproduction).

Answer ONLY JSON: {"work": "<one value>", "sure": true|false}
work MUST be one of: ${TAXONOMY.work.join(" | ")}
When genuinely torn, keep "photograph" and set sure=false. Reclassify only what is clearly another kind of work.`;

async function judge(relPath: string): Promise<{ work: string; sure: boolean } | null> {
  const abs = path.join(LIBRARY_DIR, relPath);
  const buf = await sharp(abs, { failOn: "none" }).rotate()
    .resize(640, 640, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 80, response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYS },
            { role: "user", content: [
              { type: "text", text: "Audit this image." },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64," + buf.toString("base64") } },
            ] },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      const j = await res.json() as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as { work?: string; sure?: boolean };
      const w = String(parsed.work ?? "").trim().toLowerCase();
      if (TAXONOMY.work.includes(w)) return { work: w, sure: parsed.sure !== false };
    } catch { /* retry */ }
  }
  return null;
}

const clearWork = conn.prepare("DELETE FROM image_tags WHERE image_id=? AND tag_id IN (SELECT id FROM tags WHERE kind='work')");
const getTag = conn.prepare("SELECT id FROM tags WHERE name=? AND kind='work'");
const link = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source, weight) VALUES (?,?,'ai',1)");

async function main() {
  let kept = 0, moved = 0, unsure = 0, failed = 0, done = 0;
  const movedTo = new Map<string, number>();
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const v = await judge(item.rel_path);
      done++;
      if (!v) { failed++; continue; }
      if (v.work === "photograph") { kept++; if (!v.sure) unsure++; }
      else {
        const t = getTag.get(v.work) as { id: number } | undefined;
        if (t) {
          clearWork.run(item.id);
          link.run(item.id, t.id);
          moved++;
          movedTo.set(v.work, (movedTo.get(v.work) ?? 0) + 1);
          recordEvent("archivist", "reclassify", { from: "photograph", to: v.work, judge: MODEL }, item.id);
          console.log("  #" + String(item.id).padStart(4) + "  photograph -> " + v.work);
        }
      }
      if (done % 50 === 0) console.log("  … " + done + "/" + todo.length);
    }
  }));
  console.log("\nkept " + kept + " (" + unsure + " unsure) · reclassified " + moved + " · failed " + failed);
  for (const [w, n] of [...movedTo.entries()].sort((a, b) => b[1] - a[1])) console.log("  -> " + w.padEnd(22) + n);
  recordEvent("archivist", "verify-photographs", { checked: todo.length, kept, moved, unsure, failed });
}
main();
