/*
  The catalogue pass: run the full archival analysis over the library.

  This is the pass that replaces "was a camera involved" with what each work
  IS. Every image gets the rich analysis -- work, carrier, period (with its
  evidence), materials, processes, plus the prose fields -- and its old
  `medium` links are removed as the new facets land, so the taxonomy never
  half-exists on an image.

  Resumable by design: images whose ai_model carries the v2 stamp are
  skipped, so a run that dies picks up where it stopped. Failures are
  collected and reported, never retried blindly at the end of a long run.

    ATLAS_VISION_PROVIDER=openai npx tsx scripts/catalogue-pass.ts
    ... --limit 5           # a taste before the full pass
    ... --ids 421,926       # specific images
    ... --concurrency 4

  Groq's free day is ~200k tokens and this pass needs about ten times that,
  which is why the runner insists on the OpenAI provider unless told not to.
*/
import fs from "node:fs";
import path from "node:path";

/* the same .env.local loader every standalone script here uses: next dev
   loads it for the app, tsx loads nothing */
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { db } from "../lib/db";
import { analyzeImage, VisionError } from "../lib/vision";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };

const LIMIT = Number(flag("limit", "0"));
/* Number("") is 0 and 0 is an integer: an empty --ids must yield an empty
   list, not [0], or the default run queries WHERE id IN (0) and does nothing */
const IDS = flag("ids", "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
const CONCURRENCY = Math.max(1, Number(flag("concurrency", "4")));
const STAMP = " · catalogue-v2";

if (process.env.ATLAS_VISION_PROVIDER?.trim() !== "openai" && !argv.includes("--allow-groq")) {
  console.error("This pass is ~2M tokens; Groq's free day is ~200k. Set ATLAS_VISION_PROVIDER=openai (or pass --allow-groq to insist).");
  process.exit(1);
}

const conn = db();

const rows = (IDS.length
  ? conn.prepare(`SELECT id FROM images WHERE id IN (${IDS.map(() => "?").join(",")}) ORDER BY id`).all(...IDS)
  : conn.prepare("SELECT id FROM images WHERE ai_model IS NULL OR ai_model NOT LIKE ? ORDER BY id").all("%" + STAMP)
) as { id: number }[];

const todo = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
console.log("catalogue pass · " + todo.length + " image" + (todo.length === 1 ? "" : "s") + " · concurrency " + CONCURRENCY);

const dropMedium = conn.prepare(
  "DELETE FROM image_tags WHERE image_id = ? AND tag_id IN (SELECT id FROM tags WHERE kind = 'medium')"
);
const stamp = conn.prepare("UPDATE images SET ai_model = ? WHERE id = ?");

let done = 0, failed: { id: number; err: string }[] = [];
const t0 = Date.now();

async function one(id: number) {
  try {
    const a = await analyzeImage(id);
    /* the medium era ends for this image the moment its facets exist */
    dropMedium.run(id);
    stamp.run((process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini") + STAMP, id);
    done++;
    const rate = done / ((Date.now() - t0) / 60000);
    console.log(
      "  #" + String(id).padStart(4) + "  " + String(done).padStart(4) + "/" + todo.length +
      "  " + (a.work || "?").padEnd(18) + (a.carrier || "?").padEnd(16) + (a.period || "?").padEnd(9) +
      " ~" + Math.max(1, Math.round((todo.length - done) / Math.max(rate, 0.1))) + "m left"
    );
  } catch (e) {
    const err = e instanceof VisionError ? e.message : String(e);
    failed.push({ id, err: err.slice(0, 160) });
    console.log("  #" + String(id).padStart(4) + "  FAILED  " + err.slice(0, 120));
    /* a daily-quota error means every remaining call dies the same way */
    if (/daily analysis quota/i.test(err)) throw e;
  }
}

async function main() {
  const queue = [...todo.map((r) => r.id)];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const id = queue.shift();
      if (id == null) return;
      await one(id);
    }
  });
  await Promise.all(workers);

  console.log("\n" + done + " catalogued in " + Math.round((Date.now() - t0) / 60000) + "m" +
    (failed.length ? " · " + failed.length + " failed" : " · clean"));
  if (failed.length) {
    console.log("failed ids: " + failed.map((f) => f.id).join(","));
    for (const f of failed.slice(0, 10)) console.log("  #" + f.id + "  " + f.err);
    console.log("re-run with --ids <list> to retry just these.");
  }

  /* the state of the taxonomy after this run */
  const counts = conn.prepare(
    "SELECT t.kind, COUNT(DISTINCT it.image_id) n FROM tags t JOIN image_tags it ON it.tag_id = t.id " +
    "WHERE t.kind IN ('work','carrier','period','material','process','medium') GROUP BY t.kind"
  ).all() as { kind: string; n: number }[];
  console.log("\nimages carrying each facet:");
  for (const c of counts) console.log("  " + c.kind.padEnd(9) + c.n);
}

main().catch((e) => { console.error("\nrun stopped: " + (e?.message || e)); process.exit(1); });
