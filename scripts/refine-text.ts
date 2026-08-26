/**
 * Refine text tagging: replace the crude word-count "text"/"document" tags
 * with strict, model-read classes (quote, poem, philosophy, journal, letter,
 * essay, label, poster text, typography). The classifier reads the actual OCR
 * text of each image and returns NOTHING when it is noise or uncertain.
 *   npm run refine-text
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

import { db, now } from "../lib/db";
import { classifyTexts, VisionError } from "../lib/vision";

const BATCH = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const conn = db();

  // retire the crude threshold tags entirely
  conn.exec(
    "DELETE FROM image_tags WHERE source = 'local' AND tag_id IN (SELECT id FROM tags WHERE name IN ('text','document'))"
  );
  conn.exec("DELETE FROM tags WHERE name IN ('text','document') AND id NOT IN (SELECT DISTINCT tag_id FROM image_tags)");

  const rows = (conn.prepare(
    "SELECT id, ocr_text FROM images WHERE ocr_text IS NOT NULL AND ocr_refined IS NULL"
  ).all() as { id: number; ocr_text: string }[])
    .filter((r) => r.ocr_text.split(/\s+/).filter((w) => w.length > 1).length >= 8);

  if (!rows.length) { console.log("Nothing to refine: all OCR text is classified."); return; }
  console.log("Classifying the text inside " + rows.length + " images (strict, batches of " + BATCH + ")...\n");

  const upsertTag = conn.prepare("INSERT INTO tags (name, kind) VALUES (?, 'subject') ON CONFLICT(name) DO NOTHING");
  const getTag = conn.prepare("SELECT id FROM tags WHERE name = ?");
  const linkTag = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source, weight) VALUES (?,?,'ai',1)");
  const mark = conn.prepare("UPDATE images SET ocr_refined = ? WHERE id = ?");

  const counts = new Map<string, number>();
  let classified = 0, silent = 0, failedBatches = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({ id: r.id, text: r.ocr_text }));
    try {
      const result = await classifyTexts(batch);
      conn.exec("BEGIN");
      for (const item of batch) {
        const classes = result.get(item.id) ?? [];
        for (const c of classes) {
          upsertTag.run(c);
          const tag = getTag.get(c) as { id: number };
          linkTag.run(item.id, tag.id);
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        if (classes.length) classified++; else silent++;
        mark.run(now(), item.id);
      }
      conn.exec("COMMIT");
      process.stdout.write("\r" + Math.min(i + BATCH, rows.length) + "/" + rows.length + " read...");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/per day|daily|TPD/i.test(msg)) {
        console.log("\nText-model daily quota reached; run again later to continue (resumable).");
        break;
      }
      failedBatches++;
      console.log("\n[batch skip] " + msg.slice(0, 100));
      if (failedBatches > 6) { console.log("Too many failures; stopping."); break; }
    }
    await sleep(2500);
  }

  console.log("\n\nDone.");
  console.log("  images with a confident class: " + classified);
  console.log("  judged noise / unclear:        " + silent + " (no tag applied, by design)");
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + c.padEnd(12) + " " + n);
  }
}

main().catch((e) => { console.error("refine-text crashed:", e); process.exit(1); });
