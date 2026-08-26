import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { db, now, LIBRARY_DIR, THUMB_DIR } from "./db";
import { pHash, palette, hammingHex, histDistance, similarityScore } from "./imaging";

export const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i;

export type IngestProgress = {
  total: number; done: number; added: number; skipped: number; failed: number;
  current: string; phase: "scan" | "copy" | "similarity" | "done";
};

/** ComfyUI writes its whole graph into PNG tEXt chunks. Pull it back out. */
function readPngText(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IEND") break;
    if (len > buf.length) break;
    if (type === "tEXt" || type === "iTXt") {
      const data = buf.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = data.toString("latin1", 0, nul);
        // iTXt carries compression + language sub-fields before the value; for the
        // uncompressed case ComfyUI writes, skipping the null run is enough.
        let vStart = nul + 1;
        if (type === "iTXt") {
          while (vStart < data.length && data[vStart] === 0) vStart++;
        }
        out[key] = data.toString("utf8", vStart);
      }
    }
    off += 12 + len;
  }
  return out;
}

/**
 * Dig the human-readable prompt out of a ComfyUI graph. The graph is a node
 * soup, so this walks it and keeps strings that sit under a text/prompt key.
 */
function extractPrompt(meta: Record<string, string>): string | null {
  for (const key of ["parameters", "prompt", "workflow", "Description"]) {
    const raw = meta[key];
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const found: string[] = [];
      const walk = (n: unknown) => {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n && typeof n === "object") {
          for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
            if (/text|prompt/i.test(k) && typeof v === "string" && v.trim().length > 3) found.push(v.trim());
            else walk(v);
          }
        }
      };
      walk(parsed);
      if (found.length) return [...new Set(found)].join("\n").slice(0, 4000);
    } catch {
      if (raw.length > 12) return raw.slice(0, 4000);
    }
  }
  return null;
}

function uniqueTarget(dir: string, filename: string) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext).replace(/[^\w.\- ]+/g, "_");
  let candidate = base + ext;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) candidate = base + "__" + i++ + ext;
  return candidate;
}

export async function makeThumb(libAbs: string, id: number) {
  const out = path.join(THUMB_DIR, id + ".webp");
  await sharp(libAbs, { failOn: "none" })
    .rotate()
    .resize(720, 720, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(out);
  return out;
}

/**
 * Copy one image into the managed library and index it.
 * The source file is only ever READ: originals are left exactly as they are.
 * Exported as ingestFile for single-file paths (the upload endpoint).
 */
export async function ingestOne(sourcePath: string, collectionId: number | null) {
  const conn = db();
  const stat = await fsp.stat(sourcePath);
  const buf = await fsp.readFile(sourcePath);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");

  // Content-addressed dedupe: the same bytes never enter the library twice,
  // it just joins another collection.
  const dupe = conn.prepare("SELECT id FROM images WHERE sha256 = ?").get(sha) as { id: number } | undefined;
  if (dupe) {
    if (collectionId) {
      conn.prepare("INSERT OR IGNORE INTO image_collections (image_id, collection_id, added_at) VALUES (?,?,?)")
        .run(dupe.id, collectionId, now());
    }
    return { status: "skipped" as const, id: dupe.id };
  }

  let meta: { format?: string; width?: number; height?: number };
  try {
    meta = await sharp(buf, { failOn: "none" }).metadata();
  } catch {
    throw new Error("unreadable image");
  }

  const filename = uniqueTarget(LIBRARY_DIR, path.basename(sourcePath));
  const libAbs = path.join(LIBRARY_DIR, filename);
  await fsp.copyFile(sourcePath, libAbs);

  const [hash, pal] = await Promise.all([pHash(buf), palette(buf)]);
  const png = meta.format === "png" ? readPngText(buf) : {};
  const promptText = extractPrompt(png);

  const info = conn.prepare(
    "INSERT INTO images (rel_path, filename, source_path, sha256, bytes, width, height, format," +
    " phash, histogram, palette, dominant_hex, luma, chroma, gen_meta, prompt_text, created_at, mtime)" +
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    filename, filename, sourcePath, sha, stat.size,
    meta.width ?? null, meta.height ?? null, meta.format ?? null,
    hash, JSON.stringify(pal.histogram), JSON.stringify(pal.swatches),
    pal.swatches[0]?.hex ?? null, pal.luma, pal.chroma,
    Object.keys(png).length ? JSON.stringify(png).slice(0, 20000) : null,
    promptText, now(), Math.floor(stat.mtimeMs),
  );

  const id = Number(info.lastInsertRowid);
  await makeThumb(libAbs, id).catch(() => {});
  if (collectionId) {
    conn.prepare("INSERT OR IGNORE INTO image_collections (image_id, collection_id, added_at) VALUES (?,?,?)")
      .run(id, collectionId, now());
  }
  return { status: "added" as const, id };
}

/**
 * Rebuild the cached similarity table.
 * O(n^2) over ~940 images is ~440k comparisons of a 16-char hash plus a 27-float
 * histogram. Only pairs at or above the floor are stored, so the table stays
 * small and the graph query becomes a plain index scan.
 */
export function rebuildSimilarity(floor = 0.72) {
  const conn = db();
  const rows = conn.prepare("SELECT id, phash, histogram FROM images WHERE phash IS NOT NULL").all() as
    { id: number; phash: string; histogram: string }[];

  const parsed = rows.map((r) => ({
    id: r.id,
    phash: r.phash,
    hist: JSON.parse(r.histogram || "[]") as number[],
  }));

  conn.exec("DELETE FROM similarity");
  const ins = conn.prepare("INSERT OR REPLACE INTO similarity (a_id,b_id,phash_d,color_d,score) VALUES (?,?,?,?,?)");
  conn.exec("BEGIN");
  let pairs = 0;
  try {
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const d = hammingHex(parsed[i].phash, parsed[j].phash);
        // Colour can contribute at most 0.28, so a structural score that far
        // below the floor can never clear it. Reject before touching the histogram.
        if (1 - d / 64 < floor - 0.28) continue;
        const c = histDistance(parsed[i].hist, parsed[j].hist);
        const s = similarityScore(d, c);
        if (s >= floor) { ins.run(parsed[i].id, parsed[j].id, d, c, s); pairs++; }
      }
    }
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
  return { images: parsed.length, pairs };
}

export async function ingestDirectory(
  sourceDir: string,
  collectionId: number | null,
  onProgress?: (p: IngestProgress) => void,
  concurrency = 6,
) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && IMAGE_RE.test(e.name))
    .map((e) => path.join(sourceDir, e.name));

  const p: IngestProgress = {
    total: files.length, done: 0, added: 0, skipped: 0, failed: 0, current: "", phase: "copy",
  };
  let cursor = 0;

  // sharp releases to the libuv threadpool, so a handful of workers keeps the
  // CPU busy without holding every source file in memory at once.
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      p.current = path.basename(file);
      try {
        const r = await ingestOne(file, collectionId);
        if (r.status === "added") p.added++; else p.skipped++;
      } catch {
        p.failed++;
      }
      p.done++;
      onProgress?.({ ...p });
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));

  p.phase = "similarity";
  onProgress?.({ ...p });
  const sim = rebuildSimilarity();

  p.phase = "done";
  onProgress?.({ ...p });
  return { ...p, similarity: sim };
}

export { ingestOne as ingestFile };

export function ensureCollection(name: string, parentId: number | null = null) {
  const conn = db();
  const slug = name.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  const found = conn.prepare("SELECT id FROM collections WHERE slug = ? AND parent_id IS ?")
    .get(slug, parentId) as { id: number } | undefined;
  if (found) return found.id;
  const r = conn.prepare("INSERT INTO collections (name, parent_id, slug, created_at) VALUES (?,?,?,?)")
    .run(name, parentId, slug, now());
  return Number(r.lastInsertRowid);
}
