/**
 * Re-run Windows OCR over images whose stored text was mangled.
 *
 *   npx tsx scripts/reocr.ts            # dry run: how many are damaged
 *   npx tsx scripts/reocr.ts --apply    # re-read them and replace the text
 *
 * The original pass lost every non-ASCII character: ocr.ps1 wrote stdout in
 * the console's ANSI codepage while the reader decoded it as UTF-8, so each
 * umlaut arrived as U+FFFD ("f�r" for "für"). That is unrecoverable from
 * the stored string — the bytes were already gone — so the fix is to OCR the
 * source images again now that ocr.ps1 emits UTF-8.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { db, LIBRARY_DIR } from "../lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const conn = db();
  const rows = conn.prepare(
    "SELECT id, rel_path FROM images WHERE ocr_text LIKE '%' || char(65533) || '%'"
  ).all() as { id: number; rel_path: string }[];

  console.log(rows.length + " images carry mangled OCR text");
  if (!rows.length) return;
  if (!APPLY) { console.log("DRY RUN. add --apply to re-read them."); return; }

  const tmp = path.join(os.tmpdir(), "atlas-reocr");
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });

  let exported = 0;
  for (const r of rows) {
    try {
      await sharp(path.join(LIBRARY_DIR, r.rel_path), { failOn: "none" })
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .png()
        .toFile(path.join(tmp, r.id + ".png"));
      exported++;
    } catch { /* unreadable; skip */ }
  }
  console.log("exported " + exported + " frames, running OCR...");

  const ps = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(process.cwd(), "scripts", "ocr.ps1"),
    "-Dir", tmp,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (ps.status !== 0) console.error("OCR failed:", (ps.stderr || "").slice(0, 300));

  const setOcr = conn.prepare("UPDATE images SET ocr_text = ? WHERE id = ?");
  let fixed = 0, stillBad = 0;
  conn.exec("BEGIN");
  for (const line of (ps.stdout || "").split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const id = Number(line.slice(0, tab));
    const text = line.slice(tab + 1).trim();
    if (!Number.isInteger(id)) continue;
    setOcr.run(text || null, id);
    if (text.includes("�")) stillBad++; else fixed++;
  }
  conn.exec("COMMIT");
  await fsp.rm(tmp, { recursive: true, force: true });

  console.log("re-read " + (fixed + stillBad) + ": " + fixed + " clean, " + stillBad + " still damaged");
  const left = (conn.prepare(
    "SELECT COUNT(*) c FROM images WHERE ocr_text LIKE '%' || char(65533) || '%'"
  ).get() as { c: number }).c;
  console.log(left + " images still carry a damaged character");
}

main();
