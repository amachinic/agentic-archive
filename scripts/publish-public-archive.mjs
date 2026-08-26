import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE_DB = path.resolve(process.env.ATLAS_DB_PATH || path.join(ROOT, "atlas.db"));
const LIBRARY_DIR = path.resolve(process.env.ATLAS_LIBRARY_DIR || path.join(ROOT, "library"));
const THUMB_DIR = path.resolve(process.env.ATLAS_THUMBS_DIR || path.join(ROOT, ".cache", "thumbs"));
const IMAGE_PREFIX = "archive/images";
const CATALOG_PATHNAME = "archive/catalog/atlas-public.db";
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i;
const TABLES = [
  "images",
  "tags",
  "image_tags",
  "collections",
  "image_collections",
  "links",
  "similarity",
  "edge_hides",
  "comparisons",
];
const RETAINED_IMAGE_FIELDS = ["ai_title", "ai_description", "ai_analysis", "artist"];
const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const KNOWN_UNINDEXED = {
  "logo.png": {
    title: "Corrupted Blue Line Logo",
    description: "A dark blue, vertically striped U-like emblem on a cyan field; the lower half is broken into horizontal bands because the source PNG is damaged.",
    tags: [
      ["logo", "subject"],
      ["symbol", "subject"],
      ["geometry", "subject"],
      ["grid", "subject"],
      ["geometric", "style"],
      ["minimalist", "style"],
      ["monochrome", "style"],
      ["glitch", "style"],
      ["graphic design", "medium"],
      ["tall", "format"],
    ],
  },
  "shirt style.webp": {
    title: "Brad Pitt at the SAG Awards",
    description: "A full-length event portrait of Brad Pitt in a black suit and open-collar white shirt, standing against a blue SAG-AFTRA backdrop while holding an award statuette.",
    tags: [
      ["portrait", "subject"],
      ["figure", "subject"],
      ["fashion", "subject"],
      ["signage", "subject"],
      ["editorial", "style"],
      ["bright", "style"],
      ["high contrast", "style"],
      ["documentary", "style"],
      ["calm", "mood"],
      ["photography", "medium"],
      ["tall", "format"],
    ],
  },
};

function usage() {
  console.log(`Publish a sanitized Image Archivist catalog and its thumbnails.

Usage:
  node scripts/publish-public-archive.mjs [--dry-run] [--concurrency=N]

Environment:
  BLOB_READ_WRITE_TOKEN       Vercel Blob read/write token (required unless --dry-run)
  ATLAS_PUBLISH_CONCURRENCY   Parallel thumbnail uploads, 1-16 (default: 6)
  ATLAS_DB_PATH               Source database (default: ./atlas.db)
  ATLAS_LIBRARY_DIR           Managed originals (default: ./library)
  ATLAS_THUMBS_DIR            Existing WebP thumbnails (default: ./.cache/thumbs)

The upload is restartable. Deterministic blob paths are overwritten, and the
verified catalog is uploaded last so it never points at a partially uploaded set.`);
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    concurrency: Number(process.env.ATLAS_PUBLISH_CONCURRENCY || 6),
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--concurrency=")) out.concurrency = Number(arg.slice(14));
    else throw new Error("Unknown argument: " + arg);
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 16) {
    throw new Error("Concurrency must be an integer between 1 and 16.");
  }
  return out;
}

function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function countTables(db) {
  return Object.fromEntries(
    TABLES.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]),
  );
}

function countRetainedFields(db) {
  return Object.fromEntries(
    RETAINED_IMAGE_FIELDS.map((column) => [
      column,
      Number(db.prepare(`SELECT COUNT(*) AS n FROM images WHERE ${column} IS NOT NULL AND ${column} <> ''`).get().n),
    ]),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyRequiredSchema(db) {
  const found = new Set(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name)),
  );
  for (const table of TABLES) assert(found.has(table), `Source database is missing table ${table}.`);

  const imageColumns = new Set(db.prepare("PRAGMA table_info(images)").all().map((row) => String(row.name)));
  for (const column of [
    "id", "rel_path", "filename", "source_path", "sha256", "bytes", "width", "height", "format",
    "phash", "histogram", "palette", "dominant_hex", "luma", "chroma", "gen_meta", "prompt_text",
    "ai_title", "ai_description", "ai_analysis", "ai_model", "ai_at", "rating", "flagged", "note",
    "created_at", "mtime", "ocr_text", "local_at", "ocr_refined", "artist", "artist_at",
  ]) {
    assert(imageColumns.has(column), `Source database is missing images.${column}. Run the app migrations first.`);
  }
}

function quickCheck(db, label) {
  const rows = db.prepare("PRAGMA quick_check").all();
  assert(rows.length === 1 && Object.values(rows[0])[0] === "ok", `${label} failed SQLite quick_check.`);
}

function fullIntegrityCheck(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  assert(rows.length === 1 && Object.values(rows[0])[0] === "ok", "Public catalog failed SQLite integrity_check.");
  assert(db.prepare("PRAGMA foreign_key_check").all().length === 0, "Public catalog has foreign-key violations.");
}

function snapshotDatabase(destination) {
  const source = new DatabaseSync(SOURCE_DB, { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout = 30000");
    verifyRequiredSchema(source);
    quickCheck(source, "Source database");
    // VACUUM INTO reads through SQLite's transaction layer, so committed rows
    // still living in the source WAL are included in one consistent snapshot.
    source.exec(`VACUUM INTO ${sqlString(destination)}`);
  } finally {
    source.close();
  }

  // Read comparison counts from the completed snapshot, not from separate
  // source queries that could observe different commits while Atlas is live.
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    verifyRequiredSchema(snapshot);
    quickCheck(snapshot, "Database snapshot");
    return {
      counts: countTables(snapshot),
      retained: countRetainedFields(snapshot),
      rows: snapshot.prepare("SELECT id, rel_path FROM images ORDER BY id").all().map((row) => ({
        id: Number(row.id),
        relPath: String(row.rel_path),
      })),
    };
  } finally {
    snapshot.close();
  }
}

function publicTitle(filename) {
  const stem = path.basename(filename, path.extname(filename));
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase() || "untitled";
}

async function findUnindexedImages(indexedRows) {
  const indexed = new Set(indexedRows.map((row) => row.relPath.replaceAll("\\", "/").toLowerCase()));
  const entries = await fsp.readdir(LIBRARY_DIR, { withFileTypes: true });
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return entries
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name) && !indexed.has(entry.name.toLowerCase()))
    .map((entry) => entry.name)
    .sort(collator.compare);
}

async function addUnindexedImages(db, filenames, derivedDir) {
  if (!filenames.length) {
    return {
      images: [],
      similarityPairs: 0,
      tagRows: 0,
      tagAssignments: 0,
      retained: Object.fromEntries(RETAINED_IMAGE_FIELDS.map((field) => [field, 0])),
    };
  }

  let imaging;
  try {
    const { tsImport } = await import("tsx/esm/api");
    imaging = await tsImport("../lib/imaging.ts", import.meta.url);
  } catch (error) {
    throw new Error(
      "Unindexed images require the existing TypeScript imaging helpers. Install dependencies so tsx can load lib/imaging.ts. " +
      (error instanceof Error ? error.message : "Loader failed."),
    );
  }

  for (const name of ["pHash", "palette", "hammingHex", "histDistance", "similarityScore"]) {
    assert(typeof imaging[name] === "function", `lib/imaging.ts does not expose ${name}.`);
  }
  await fsp.mkdir(derivedDir, { recursive: true });
  let nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM images").get().id) + 1;
  const insert = db.prepare(`
    INSERT INTO images (
      id, rel_path, filename, source_path, sha256, bytes, width, height, format,
      phash, histogram, palette, dominant_hex, luma, chroma, gen_meta, prompt_text,
      ai_title, ai_description, ai_analysis, ai_model, ai_at, rating, flagged, note,
      created_at, mtime, ocr_text, local_at, ocr_refined, artist, artist_at
    ) VALUES (
      ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
      ?, ?, NULL, 'manual review', ?, 0, 0, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL
    )
  `);
  const findTag = db.prepare("SELECT id, kind FROM tags WHERE name = ? COLLATE NOCASE");
  const insertTag = db.prepare("INSERT INTO tags (name, kind) VALUES (?, ?)");
  const insertImageTag = db.prepare("INSERT INTO image_tags (image_id, tag_id, source, weight) VALUES (?, ?, 'manual', 1)");

  const added = [];
  let tagRows = 0;
  let tagAssignments = 0;
  const retained = Object.fromEntries(RETAINED_IMAGE_FIELDS.map((field) => [field, 0]));
  for (const filename of filenames) {
    const sourcePath = path.join(LIBRARY_DIR, filename);
    const source = await fsp.readFile(sourcePath);
    const stat = await fsp.stat(sourcePath);
    const metadata = await sharp(source, { failOn: "none" }).metadata();
    assert(metadata.width && metadata.height, "An unindexed image has no readable dimensions.");

    const id = nextId++;
    const publicFilename = `${id}.webp`;
    const known = KNOWN_UNINDEXED[filename.toLowerCase()] ?? null;
    const title = known?.title ?? publicTitle(filename);
    const description = known?.description ?? null;
    const cataloguedAt = Date.now();
    const derivativePath = path.join(derivedDir, publicFilename);
    const derivative = await sharp(source, { failOn: "none" })
      .rotate()
      .resize(720, 720, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await fsp.writeFile(derivativePath, derivative, { flag: "wx" });

    // Analyze the same normalized derivative that becomes public. This still
    // uses the archive's canonical algorithms and tolerates damaged metadata
    // in an otherwise decodable source image.
    const [hash, colors] = await Promise.all([
      imaging.pHash(Buffer.from(derivative)),
      imaging.palette(Buffer.from(derivative)),
    ]);

    insert.run(
      id,
      publicFilename,
      publicFilename,
      "public:" + id,
      stat.size,
      metadata.width,
      metadata.height,
      metadata.format ?? null,
      hash,
      JSON.stringify(colors.histogram),
      JSON.stringify(colors.swatches),
      colors.swatches[0]?.hex ?? null,
      colors.luma,
      colors.chroma,
      title,
      description,
      cataloguedAt,
      cataloguedAt,
    );

    for (const [name, kind] of known?.tags ?? []) {
      let tag = findTag.get(name);
      if (!tag) {
        const result = insertTag.run(name, kind);
        tag = { id: Number(result.lastInsertRowid), kind };
        tagRows += Number(result.changes);
      }
      assert(String(tag.kind) === kind, `Canonical tag ${name} exists under the wrong kind.`);
      const assignment = insertImageTag.run(id, Number(tag.id));
      assert(Number(assignment.changes) === 1, `Could not assign canonical tag ${name} to public image ${id}.`);
      tagAssignments++;
    }
    retained.ai_title++;
    if (description) retained.ai_description++;
    added.push({ id, thumbPath: derivativePath });
  }

  const newIds = new Set(added.map((item) => item.id));
  const rows = db.prepare("SELECT id, phash, histogram FROM images WHERE phash IS NOT NULL AND histogram IS NOT NULL ORDER BY id").all()
    .map((row) => ({ id: Number(row.id), phash: String(row.phash), histogram: JSON.parse(String(row.histogram)) }));
  const insertSimilarity = db.prepare("INSERT OR REPLACE INTO similarity (a_id, b_id, phash_d, color_d, score) VALUES (?, ?, ?, ?, ?)");
  let similarityPairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!newIds.has(rows[i].id) && !newIds.has(rows[j].id)) continue;
      const phashDistance = imaging.hammingHex(rows[i].phash, rows[j].phash);
      const colorDistance = imaging.histDistance(rows[i].histogram, rows[j].histogram);
      const score = imaging.similarityScore(phashDistance, colorDistance);
      if (score >= 0.72) {
        insertSimilarity.run(rows[i].id, rows[j].id, phashDistance, colorDistance, score);
        similarityPairs++;
      }
    }
  }
  const expectedAssignments = filenames.reduce(
    (sum, filename) => sum + (KNOWN_UNINDEXED[filename.toLowerCase()]?.tags.length ?? 0),
    0,
  );
  assert(tagAssignments === expectedAssignments, "Public image tag assignments did not match the expected mappings.");
  if (added.length) {
    const placeholders = added.map(() => "?").join(",");
    const assigned = Number(db.prepare(`SELECT COUNT(*) AS n FROM image_tags WHERE image_id IN (${placeholders})`).get(...added.map((item) => item.id)).n);
    assert(assigned === expectedAssignments, "Unexpected tag assignments were attached to public-only images.");
    const manual = Number(db.prepare(`SELECT COUNT(*) AS n FROM image_tags WHERE source = 'manual' AND image_id IN (${placeholders})`).get(...added.map((item) => item.id)).n);
    assert(manual === expectedAssignments, "Public-only image tags were not recorded as manual assignments.");
  }
  return { images: added, similarityPairs, tagRows, tagAssignments, retained };
}

async function sanitizeSnapshot(snapshotPath, source, unindexedFiles, derivedDir) {
  const db = new DatabaseSync(snapshotPath);
  try {
    db.exec("PRAGMA busy_timeout = 30000");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec("PRAGMA secure_delete = ON");
    db.exec("BEGIN IMMEDIATE");
    let additions;
    try {
      additions = await addUnindexedImages(db, unindexedFiles, derivedDir);
      db.exec(`
        UPDATE images SET
          rel_path = printf('%d.webp', id),
          filename = printf('%d.webp', id),
          source_path = NULL,
          sha256 = printf('public:%d', id),
          gen_meta = NULL,
          prompt_text = NULL,
          ocr_text = NULL,
          note = NULL,
          mtime = NULL;
        UPDATE collections SET note = NULL;
        UPDATE links SET note = NULL;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    // Remove old values from free pages before this file can leave the machine.
    db.exec("VACUUM");
    fullIntegrityCheck(db);

    const counts = countTables(db);
    const retained = countRetainedFields(db);
    assert(counts.images === source.counts.images + additions.images.length, "Public image count changed unexpectedly.");
    assert(counts.similarity === source.counts.similarity + additions.similarityPairs, "Public similarity count changed unexpectedly.");
    assert(counts.tags === source.counts.tags + additions.tagRows, "Public tag-row count changed unexpectedly.");
    assert(counts.image_tags === source.counts.image_tags + additions.tagAssignments, "Public image-tag count changed unexpectedly.");
    for (const table of TABLES.filter((name) => !["images", "similarity", "tags", "image_tags"].includes(name))) {
      assert(counts[table] === source.counts[table], `Public ${table} count changed unexpectedly.`);
    }
    for (const column of RETAINED_IMAGE_FIELDS) {
      const expected = source.retained[column] + additions.retained[column];
      assert(retained[column] === expected, `Public images.${column} was not preserved.`);
    }

    const privacy = db.prepare(`
      SELECT COUNT(*) AS n FROM images
      WHERE source_path IS NOT NULL OR gen_meta IS NOT NULL OR prompt_text IS NOT NULL
         OR ocr_text IS NOT NULL OR note IS NOT NULL OR mtime IS NOT NULL
         OR rel_path <> printf('%d.webp', id)
         OR filename <> printf('%d.webp', id)
         OR sha256 <> printf('public:%d', id)
    `).get();
    assert(Number(privacy.n) === 0, "Public catalog still contains private image fields.");
    assert(Number(db.prepare("SELECT COUNT(*) AS n FROM collections WHERE note IS NOT NULL").get().n) === 0, "Collection notes were not cleared.");
    assert(Number(db.prepare("SELECT COUNT(*) AS n FROM links WHERE note IS NOT NULL").get().n) === 0, "Link notes were not cleared.");
    assert(Number(db.prepare("PRAGMA freelist_count").get().freelist_count) === 0, "Public catalog still has free pages after sanitization.");

    return {
      counts,
      added: additions.images,
      addedSimilarity: additions.similarityPairs,
      addedTagRows: additions.tagRows,
      addedTagAssignments: additions.tagAssignments,
    };
  } finally {
    db.close();
  }
}

async function inspectWebp(filePath) {
  const data = await fsp.readFile(filePath);
  assert(data.length >= 20, "A public thumbnail is empty or truncated.");
  assert(data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP", "A public thumbnail is not WebP.");
  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunk = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32LE(offset + 4);
    assert(!WEBP_METADATA_CHUNKS.has(chunk), `A public thumbnail contains a ${chunk.trim()} metadata chunk.`);
    offset += 8 + size + (size & 1);
    assert(offset <= data.length, "A public thumbnail has an invalid RIFF chunk length.");
  }
  return data.length;
}

async function collectThumbnails(imageIds, added) {
  const derived = new Map(added.map((item) => [item.id, item.thumbPath]));
  const thumbnails = [];
  let bytes = 0;
  for (const id of imageIds) {
    const thumbPath = derived.get(id) || path.join(THUMB_DIR, `${id}.webp`);
    let stat;
    try {
      stat = await fsp.stat(thumbPath);
    } catch {
      throw new Error(`Missing public thumbnail for catalog image ${id}.`);
    }
    assert(stat.isFile(), `Public thumbnail ${id} is not a file.`);
    bytes += await inspectWebp(thumbPath);
    thumbnails.push({ id, path: thumbPath });
  }
  return { thumbnails, bytes };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  let firstError = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!firstError) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  });
  await Promise.all(runners);
  if (firstError) throw firstError;
}

async function putWithRetry(put, pathname, body, options) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await put(pathname, body, {
        ...options,
        abortSignal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt + Math.random() * 250));
    }
  }
  throw lastError;
}

async function uploadArchive(snapshotPath, thumbnails, concurrency, token) {
  let put;
  try {
    ({ put } = await import("@vercel/blob"));
  } catch {
    throw new Error("@vercel/blob is not installed. Install it before publishing.");
  }

  let completed = 0;
  let firstBlob = null;
  await mapLimit(thumbnails, concurrency, async (item) => {
    const body = await fsp.readFile(item.path);
    const blob = await putWithRetry(put, `${IMAGE_PREFIX}/${item.id}.webp`, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
      contentType: "image/webp",
      token,
    });
    firstBlob ||= blob;
    completed++;
    if (completed % 50 === 0 || completed === thumbnails.length) {
      console.log(`Uploaded thumbnails: ${completed}/${thumbnails.length}`);
    }
  });

  const database = await fsp.readFile(snapshotPath);
  const digest = crypto.createHash("sha256").update(database).digest("hex");
  const catalogBlob = await putWithRetry(put, CATALOG_PATHNAME, database, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/vnd.sqlite3",
    token,
  });

  const imageOrigin = new URL(firstBlob.url).origin;
  return {
    blobBaseUrl: imageOrigin,
    databaseUrl: `${catalogBlob.url}?v=${digest.slice(0, 16)}`,
    digest,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function safeMessage(error, token) {
  let message = error instanceof Error ? error.message : String(error);
  if (token) message = message.replaceAll(token, "[redacted]");
  message = message.replace(/vercel_blob_rw_[^\s"']+/gi, "[redacted]");
  message = message.replaceAll(ROOT, ".");
  return message;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
  if (!options.dryRun && !token) throw new Error("BLOB_READ_WRITE_TOKEN is required. Use --dry-run to verify without uploading.");
  assert(fs.existsSync(SOURCE_DB), "Source database does not exist.");
  assert(fs.existsSync(LIBRARY_DIR), "Managed library directory does not exist.");
  assert(fs.existsSync(THUMB_DIR), "Thumbnail directory does not exist.");

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "atlas-public-"));
  const snapshotPath = path.join(tempDir, "atlas-public.db");
  const derivedDir = path.join(tempDir, "derived");
  try {
    const source = snapshotDatabase(snapshotPath);
    const unindexedFiles = await findUnindexedImages(source.rows);
    const sanitized = await sanitizeSnapshot(snapshotPath, source, unindexedFiles, derivedDir);

    const verify = new DatabaseSync(snapshotPath, { readOnly: true });
    const imageIds = verify.prepare("SELECT id FROM images ORDER BY id").all().map((row) => Number(row.id));
    fullIntegrityCheck(verify);
    verify.close();

    const media = await collectThumbnails(imageIds, sanitized.added);
    const dbSize = (await fsp.stat(snapshotPath)).size;
    console.log(`Verified catalog: ${sanitized.counts.images} images (${source.counts.images} indexed + ${sanitized.added.length} added), ${sanitized.counts.tags} tags, ${sanitized.addedTagAssignments} public tag assignments, ${sanitized.counts.collections} collections, ${sanitized.counts.similarity} similarity pairs.`);
    console.log(`Verified media: ${media.thumbnails.length} metadata-free WebP thumbnails, ${formatBytes(media.bytes)}; catalog ${formatBytes(dbSize)}.`);

    if (options.dryRun) {
      console.log("Dry run complete: no files were uploaded.");
      return;
    }

    const published = await uploadArchive(snapshotPath, media.thumbnails, options.concurrency, token);
    console.log(`Published catalog SHA-256: ${published.digest}`);
    console.log(`ATLAS_BLOB_BASE_URL=${published.blobBaseUrl}`);
    console.log(`ATLAS_PUBLIC_DB_URL=${published.databaseUrl}`);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
main().catch((error) => {
  console.error("Public archive publish failed: " + safeMessage(error, token));
  process.exitCode = 1;
});
