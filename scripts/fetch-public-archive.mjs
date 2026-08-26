import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DESTINATION = path.join(process.cwd(), "data", "atlas-public.db");
const REQUIRED_TABLES = [
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

function usage() {
  console.log(`Fetch the verified public Image Archivist catalog for a build.

Usage:
  ATLAS_PUBLIC_DB_URL=https://... node scripts/fetch-public-archive.mjs

Environment:
  ATLAS_PUBLIC_DB_URL       Published SQLite URL (required)
  ATLAS_PUBLIC_DB_PATH      Destination (default: ./data/atlas-public.db)
  ATLAS_PUBLIC_DB_MAX_BYTES Download limit (default: 134217728)`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyDatabase(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    assert(bytesRead === 16 && header.toString("binary") === "SQLite format 3\0", "Downloaded file is not a SQLite database.");
  } finally {
    await handle.close();
  }

  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const integrity = db.prepare("PRAGMA integrity_check").all();
    assert(integrity.length === 1 && Object.values(integrity[0])[0] === "ok", "Downloaded catalog failed SQLite integrity_check.");
    assert(db.prepare("PRAGMA foreign_key_check").all().length === 0, "Downloaded catalog has foreign-key violations.");

    const found = new Set(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name)),
    );
    for (const table of REQUIRED_TABLES) assert(found.has(table), `Downloaded catalog is missing table ${table}.`);

    const images = Number(db.prepare("SELECT COUNT(*) AS n FROM images").get().n);
    assert(images > 0, "Downloaded catalog contains no images.");
    const privateRows = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM images
      WHERE source_path IS NOT NULL OR gen_meta IS NOT NULL OR prompt_text IS NOT NULL
         OR ocr_text IS NOT NULL OR note IS NOT NULL OR mtime IS NOT NULL
         OR rel_path <> printf('%d.webp', id)
         OR filename <> printf('%d.webp', id)
         OR sha256 <> printf('public:%d', id)
    `).get().n);
    assert(privateRows === 0, "Downloaded catalog is not a sanitized public snapshot.");
    return images;
  } finally {
    db.close();
  }
}

async function replaceFile(tempPath, destination) {
  try {
    await fsp.rename(tempPath, destination);
    return;
  } catch (error) {
    if (!fs.existsSync(destination) || !["EACCES", "EEXIST", "EPERM", "ENOTEMPTY"].includes(error?.code)) throw error;
  }

  const backup = `${destination}.previous-${process.pid}-${Date.now()}`;
  await fsp.rename(destination, backup);
  try {
    await fsp.rename(tempPath, destination);
    await fsp.rm(backup, { force: true });
  } catch (error) {
    if (!fs.existsSync(destination) && fs.existsSync(backup)) await fsp.rename(backup, destination);
    throw error;
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  assert(process.argv.length === 2, "Unknown argument. Use --help for usage.");

  const rawUrl = process.env.ATLAS_PUBLIC_DB_URL?.trim();
  assert(rawUrl, "ATLAS_PUBLIC_DB_URL is required.");
  const url = new URL(rawUrl);
  assert(url.protocol === "https:", "ATLAS_PUBLIC_DB_URL must use HTTPS.");
  assert(!url.username && !url.password, "ATLAS_PUBLIC_DB_URL must not contain credentials.");

  const destination = path.resolve(process.env.ATLAS_PUBLIC_DB_PATH || DEFAULT_DESTINATION);
  const maxBytes = Number(process.env.ATLAS_PUBLIC_DB_MAX_BYTES || 128 * 1024 * 1024);
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, "ATLAS_PUBLIC_DB_MAX_BYTES must be a positive integer.");
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  const tempPath = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let bytes = 0;
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    assert(response.ok, `Catalog download failed with HTTP ${response.status}.`);
    assert(response.body, "Catalog download returned an empty body.");
    assert(new URL(response.url).protocol === "https:", "Catalog download redirected away from HTTPS.");
    const advertised = Number(response.headers.get("content-length") || 0);
    assert(!advertised || advertised <= maxBytes, "Published catalog exceeds the configured download limit.");

    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new Error("Published catalog exceeds the configured download limit."));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(tempPath, { flags: "wx" }));
    assert(bytes > 0, "Catalog download returned an empty file.");

    const tempHandle = await fsp.open(tempPath, "r+");
    try {
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    const images = await verifyDatabase(tempPath);
    await replaceFile(tempPath, destination);
    console.log(`Fetched public archive: ${images} images, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
  } finally {
    await fsp.rm(tempPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Public archive fetch failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
