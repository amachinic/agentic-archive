/**
 * Bulk ingest from the command line.
 *   npm run ingest -- "C:/path/to/folder" "Collection Name"
 * Falls back to ATLAS_SOURCE_DIR from .env.local when no path is given.
 */
import fs from "node:fs";
import path from "node:path";
import { ingestDirectory, ensureCollection } from "../lib/ingest";

// Minimal .env.local reader: this script runs outside Next, which is what
// normally loads the file.
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const dir = process.argv[2] || process.env.ATLAS_SOURCE_DIR || "";
if (!dir || !fs.existsSync(dir)) {
  console.error("Source directory not found:", dir);
  process.exit(1);
}
const collectionName = process.argv[3] || path.basename(dir);

async function main() {
  const started = Date.now();
  const collectionId = ensureCollection(collectionName);
  console.log("Ingesting " + dir + "\n  into collection: " + collectionName + " (#" + collectionId + ")\n");

  let lastLine = 0;
  const result = await ingestDirectory(dir, collectionId, (p) => {
    const t = Date.now();
    if (p.phase === "copy" && t - lastLine < 250 && p.done < p.total) return;
    lastLine = t;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const bar = "#".repeat(Math.round(pct / 2.5)).padEnd(40, ".");
    process.stdout.write(
      "\r[" + bar + "] " + pct + "%  " + p.done + "/" + p.total +
      "  +" + p.added + " new  " + p.skipped + " dupe  " + p.failed + " fail   " +
      (p.phase === "similarity" ? "building similarity graph..." : p.current.slice(0, 28).padEnd(28))
    );
  });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n\nDone in " + secs + "s");
  console.log("  added:      " + result.added);
  console.log("  duplicates: " + result.skipped);
  console.log("  failed:     " + result.failed);
  console.log("  similarity: " + result.similarity.pairs + " pairs across " + result.similarity.images + " images");
}

main().catch((e) => {
  console.error("\nIngest failed:", e);
  process.exit(1);
});
