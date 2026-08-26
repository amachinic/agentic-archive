/**
 * Local tagging: no API, no cost, minutes not days.
 *  - colour names, light/dark, monochrome/colourful, minimal, high contrast,
 *    tall/wide/square/panoramic from the fingerprints computed at ingest
 *  - REAL text extraction from every image via the Windows built-in OCR
 *    engine, so journals, quotes, notes and typography become searchable
 *   npm run tag-local
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { db, now, LIBRARY_DIR } from "../lib/db";
import type { Swatch } from "../lib/imaging";

/* ---- colour naming ---- */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function colorName(s: Swatch): string | null {
  const [h, sat, l] = rgbToHsl(s.r, s.g, s.b);
  if (l < 0.11) return "black";
  if (l > 0.93) return "white";
  if (sat < 0.13) return "grey";
  if (h < 15 || h >= 340) return l < 0.35 && sat < 0.7 ? "brown" : "red";
  if (h < 42) return l < 0.42 ? "brown" : "orange";
  if (h < 68) return "yellow";
  if (h < 150) return "green";
  if (h < 197) return "teal";
  if (h < 255) return "blue";
  if (h < 292) return "purple";
  return "pink";
}

function localTags(palette: Swatch[], luma: number, chroma: number, w: number, h: number): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];

  for (const s of palette) {
    if (s.pct < 0.16) continue;
    const c = colorName(s);
    if (c && !out.some((t) => t.name === c)) out.push({ name: c, kind: "color" });
  }

  if (chroma < 0.045) out.push({ name: "monochrome", kind: "style" });
  else if (chroma > 0.22) out.push({ name: "colorful", kind: "style" });
  if (luma < 0.24) out.push({ name: "dark", kind: "style" });
  else if (luma > 0.78) out.push({ name: "bright", kind: "style" });
  if (palette[0]?.pct > 0.72) out.push({ name: "minimalist", kind: "style" });

  const darkMass = palette.filter((s) => rgbToHsl(s.r, s.g, s.b)[2] < 0.16 && s.pct > 0.14).length;
  const lightMass = palette.filter((s) => rgbToHsl(s.r, s.g, s.b)[2] > 0.86 && s.pct > 0.14).length;
  if (darkMass && lightMass) out.push({ name: "high contrast", kind: "style" });

  const ar = w && h ? w / h : 1;
  /* the FRAME's shape. Named tall/wide rather than portrait/landscape: tag
     names are globally unique, so borrowing a subject word made every tall
     image read as portraiture. */
  if (ar > 2) out.push({ name: "panoramic", kind: "format" });
  else if (ar > 1.15) out.push({ name: "wide", kind: "format" });
  else if (ar < 0.87) out.push({ name: "tall", kind: "format" });
  else out.push({ name: "square", kind: "format" });

  return out;
}

async function main() {
  const conn = db();
  const rows = conn.prepare(
    "SELECT id, rel_path, palette, luma, chroma, width, height FROM images WHERE local_at IS NULL"
  ).all() as { id: number; rel_path: string; palette: string | null; luma: number | null; chroma: number | null; width: number | null; height: number | null }[];

  if (!rows.length) { console.log("Local tagging already complete."); return; }
  console.log("Local tagging " + rows.length + " images (fingerprint tags + Windows OCR)...\n");

  /* ---- pass 1: fingerprint-derived tags (instant) ---- */
  const upsertTag = conn.prepare("INSERT INTO tags (name, kind) VALUES (?,?) ON CONFLICT(name) DO NOTHING");
  const getTag = conn.prepare("SELECT id FROM tags WHERE name = ?");
  const linkTag = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source, weight) VALUES (?,?,'local',1)");

  conn.exec("BEGIN");
  let tagCount = 0;
  for (const r of rows) {
    const palette = r.palette ? (JSON.parse(r.palette) as Swatch[]) : [];
    for (const t of localTags(palette, r.luma ?? 0.5, r.chroma ?? 0.1, r.width ?? 1, r.height ?? 1)) {
      upsertTag.run(t.name, t.kind);
      const tag = getTag.get(t.name) as { id: number };
      linkTag.run(r.id, tag.id);
      tagCount++;
    }
  }
  conn.exec("COMMIT");
  console.log("Fingerprint tags: " + tagCount + " applied.");

  /* ---- pass 2: OCR via Windows.Media.Ocr ---- */
  const tmp = path.join(os.tmpdir(), "atlas-ocr");
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });

  console.log("Exporting frames for OCR...");
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
    if (exported % 150 === 0 && exported) console.log("  " + exported + "/" + rows.length);
  }

  console.log("Running Windows OCR over " + exported + " frames (this is the slow part)...");
  const ps = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(process.cwd(), "scripts", "ocr.ps1"),
    "-Dir", tmp,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  if (ps.status !== 0) {
    console.error("OCR pass failed:", (ps.stderr || "").slice(0, 400));
  }

  const setOcr = conn.prepare("UPDATE images SET ocr_text = ? WHERE id = ?");
  let textImages = 0, documents = 0;
  conn.exec("BEGIN");
  for (const line of (ps.stdout || "").split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const id = Number(line.slice(0, tab));
    const text = line.slice(tab + 1).trim();
    if (!Number.isInteger(id)) continue;
    setOcr.run(text || null, id);
    const words = text ? text.split(/\s+/).filter((w) => w.length > 1).length : 0;
    // NO tags from word counts: semantic text classes (quote, journal,
    // philosophy...) are assigned by the strict classifier in refine-text.
    if (words >= 8) textImages++;
    if (words >= 30) documents++;
  }
  // mark the batch done
  const mark = conn.prepare("UPDATE images SET local_at = ? WHERE id = ?");
  for (const r of rows) mark.run(now(), r.id);
  conn.exec("COMMIT");

  await fsp.rm(tmp, { recursive: true, force: true });

  console.log("\nDone.");
  console.log("  images processed:   " + rows.length);
  console.log("  fingerprint tags:   " + tagCount);
  console.log("  images with text:   " + textImages + " (" + documents + " read as documents)");
  console.log("Everything above is now searchable in library search and prompt discovery.");
}

main().catch((e) => { console.error("tag-local crashed:", e); process.exit(1); });
