/**
 * Identify artists / creators from evidence: filename + the text inside the
 * image. Strictly evidence-based; images with no named creator stay unnamed.
 *   npm run identify-artists
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
import { identifyArtists, VisionError } from "../lib/vision";

const BATCH = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Filename -> readable evidence: strip noise that cannot name anyone. */
function cleanName(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/tumblr_[a-z0-9]+/gi, " ")
    .replace(/\b\d{2,4}x\d{2,4}\b/gi, " ")
    .replace(/\b\d{5,}\b/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the evidence plausibly contain a name at all? */
function hasSignal(cleaned: string, ocr: string | null): boolean {
  const words = cleaned.split(" ").filter((w) => /^[a-z]{3,}$/i.test(w));
  if (words.length >= 2) return true;
  if (ocr && ocr.split(/\s+/).filter((w) => w.length > 1).length >= 4) return true;
  return false;
}

async function main() {
  const conn = db();
  const rows = (conn.prepare(
    "SELECT id, filename, ocr_text, ai_title FROM images WHERE artist_at IS NULL"
  ).all() as { id: number; filename: string; ocr_text: string | null; ai_title: string | null }[]);

  const markOnly = conn.prepare("UPDATE images SET artist_at = ? WHERE id = ?");
  const candidates: { id: number; evidence: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const cleaned = cleanName(r.filename);
    if (!hasSignal(cleaned, r.ocr_text)) {
      // numeric hashes and anonymous files carry no evidence; mark and move on
      markOnly.run(now(), r.id);
      skipped++;
      continue;
    }
    let evidence = "filename: " + cleaned;
    if (r.ai_title) evidence += "\ntitle: " + r.ai_title;
    if (r.ocr_text) evidence += "\ntext in image: " + r.ocr_text.slice(0, 260);
    candidates.push({ id: r.id, evidence });
  }

  if (!candidates.length) { console.log("Nothing to identify (" + skipped + " skipped as evidence-free)."); return; }
  console.log("Identifying creators for " + candidates.length + " images with evidence (" + skipped + " skipped: no evidence).\n");

  const setArtist = conn.prepare("UPDATE images SET artist = ?, artist_at = ? WHERE id = ?");
  const upsertTag = conn.prepare("INSERT INTO tags (name, kind) VALUES (?, 'artist') ON CONFLICT(name) DO NOTHING");
  const getTag = conn.prepare("SELECT id FROM tags WHERE name = ?");
  const linkTag = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source, weight) VALUES (?,?,'ai',1)");

  let named = 0, anonymous = 0, failedBatches = 0;
  const found = new Map<string, number>();

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    try {
      const result = await identifyArtists(batch);
      conn.exec("BEGIN");
      for (const item of batch) {
        const hit = result.get(item.id);
        if (hit) {
          setArtist.run(hit.name, now(), item.id);
          const tagName = hit.name.toLowerCase();
          upsertTag.run(tagName);
          const tag = getTag.get(tagName) as { id: number };
          linkTag.run(item.id, tag.id);
          named++;
          found.set(hit.name, (found.get(hit.name) ?? 0) + 1);
        } else {
          markOnly.run(now(), item.id);
          anonymous++;
        }
      }
      conn.exec("COMMIT");
      process.stdout.write("\r" + Math.min(i + BATCH, candidates.length) + "/" + candidates.length + " examined · " + named + " named...");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/per day|daily|TPD/i.test(msg)) {
        console.log("\nText-model daily quota reached; run again later (resumable).");
        break;
      }
      failedBatches++;
      console.log("\n[batch skip] " + msg.slice(0, 100));
      if (failedBatches > 6) { console.log("Too many failures; stopping."); break; }
    }
    await sleep(2500);
  }

  console.log("\n\nDone.");
  console.log("  named:      " + named);
  console.log("  anonymous:  " + (anonymous + skipped) + " (no evidence, no guess)");
  const top = [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (top.length) {
    console.log("  creators found:");
    for (const [n, c] of top) console.log("    " + n + (c > 1 ? "  x" + c : ""));
  }
}

main().catch((e) => { console.error("identify-artists crashed:", e); process.exit(1); });
