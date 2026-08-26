/**
 * Work through every un-analyzed image with the quick tagging pass, paced to
 * the Groq TPM cap. Resumable: it always picks up wherever it stopped.
 *   npm run tag-backlog
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

import { db } from "../lib/db";
import { quickTagImage, VisionError } from "../lib/vision";

const PACE_MS = 20_000; // ~3 calls/min at ~2.5k tokens each stays under 8k TPM

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const conn = db();
  const total = (conn.prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number }).n;
  let done = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE ai_at IS NOT NULL").get() as { n: number }).n;
  const backlog = total - done;
  if (!backlog) { console.log("Backlog clear: all " + total + " images are analyzed."); return; }

  console.log("Tagging backlog: " + backlog + " of " + total + " images to go.");
  console.log("Pace ~3/min (TPM cap) -> ETA ~" + Math.round(backlog / 3) + " min. Resumable; Ctrl+C any time.\n");

  const started = Date.now();
  let processed = 0, failed = 0;

  for (;;) {
    const next = conn.prepare(
      "SELECT id, filename FROM images WHERE ai_at IS NULL ORDER BY id LIMIT 1"
    ).get() as { id: number; filename: string } | undefined;
    if (!next) break;

    const t0 = Date.now();
    try {
      const r = await quickTagImage(next.id);
      processed++;
      done++;
      const rate = processed / ((Date.now() - started) / 60000);
      const eta = Math.round((total - done) / Math.max(0.1, rate));
      console.log(
        "[" + done + "/" + total + "] #" + next.id + " " + next.filename.slice(0, 34).padEnd(34) +
        " -> \"" + r.title.slice(0, 30) + "\" (" + r.tags + " terms) · " + ((Date.now() - t0) / 1000).toFixed(0) + "s · ~" + eta + " min left"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/per day|daily|TPD/i.test(msg)) {
        // rolling 24h window: parse "try again in XhYmZs", wait it out, retry
        const m = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)?s?/);
        let waitMs = 20 * 60_000;
        if (m && (m[1] || m[2] || m[3])) {
          waitMs = ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000 + 45_000;
        }
        waitMs = Math.max(60_000, Math.min(waitMs, 3 * 3600_000));
        console.log("[quota] daily window full (" + (total - done) + " images left). Waiting " +
          Math.ceil(waitMs / 60000) + " min for the rolling window to free tokens, then continuing...");
        await sleep(waitMs);
        continue;
      }
      failed++;
      console.log("[skip] #" + next.id + " " + next.filename.slice(0, 30) + " failed: " + msg.slice(0, 90));
      // mark a placeholder so a broken image cannot wedge the loop; clear
      // ai_title stays null-ish so a re-run script pass could retry later
      conn.prepare("UPDATE images SET ai_at = ? , ai_model = 'quick-failed' WHERE id = ?").run(Date.now(), next.id);
      if (failed > 25) { console.log("Too many consecutive failures; stopping."); return; }
    }

    const spent = Date.now() - t0;
    if (spent < PACE_MS) await sleep(PACE_MS - spent);
  }

  console.log("\nBacklog complete: " + done + "/" + total + " analyzed (" + failed + " failed).");
}

main().catch((e) => { console.error("tag-backlog crashed:", e); process.exit(1); });
