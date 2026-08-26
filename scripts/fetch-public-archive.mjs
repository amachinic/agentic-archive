import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DESTINATION = path.join(process.cwd(), "data", "atlas-public.db");
const PUBLIC_SCHEMA = Object.freeze({
  collections: ["id", "name", "parent_id", "slug", "note", "created_at"],
  comparisons: ["id", "a_id", "b_id", "verdict", "body", "model", "created_at"],
  edge_hides: ["a_id", "b_id"],
  image_collections: ["image_id", "collection_id", "added_at"],
  image_tags: ["image_id", "tag_id", "source", "weight"],
  images: [
    "id", "rel_path", "filename", "source_path", "sha256", "bytes", "width", "height", "format",
    "phash", "histogram", "palette", "dominant_hex", "luma", "chroma", "gen_meta", "prompt_text",
    "ai_title", "ai_description", "ai_analysis", "ai_model", "ai_at", "rating", "flagged", "note",
    "created_at", "mtime", "ocr_text", "local_at", "ocr_refined", "artist", "artist_at",
  ],
  links: ["id", "from_id", "to_id", "kind", "note", "created_at"],
  similarity: ["a_id", "b_id", "phash_d", "color_d", "score"],
  tags: ["id", "name", "kind", "color"],
});

function usage() {
  console.log(`Fetch the verified public Image Archivist catalog for a build.

Usage:
  ATLAS_PUBLIC_DB_URL=https://... node scripts/fetch-public-archive.mjs

Environment:
  ATLAS_ARCHIVE_MODE        Must be public
  ATLAS_BLOB_BASE_URL       Credential-free HTTPS Blob origin (required)
  ATLAS_PUBLIC_DB_URL       Published SQLite URL (required)
  ATLAS_PUBLIC_DB_PATH      Destination (default: ./data/atlas-public.db)
  ATLAS_PUBLIC_DB_MAX_BYTES Download limit (default: 134217728)`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactList(actual, expected, label) {
  assert(
    actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    `${label} must be exactly [${expected.join(", ")}]; found [${actual.join(", ")}].`,
  );
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

    const publicTables = db.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      ORDER BY name
    `).all().map((row) => String(row.name));
    const expectedTables = Object.keys(PUBLIC_SCHEMA).sort();
    assertExactList(publicTables, expectedTables, "Downloaded catalog user tables");

    for (const table of expectedTables) {
      const columns = db.prepare("SELECT name, hidden FROM pragma_table_xinfo(?) ORDER BY cid").all(table);
      assert(columns.every((column) => Number(column.hidden) === 0), `Downloaded catalog table ${table} contains hidden columns.`);
      assertExactList(
        columns.map((column) => String(column.name)),
        PUBLIC_SCHEMA[table],
        `Downloaded catalog columns for ${table}`,
      );
    }

    const executableObjects = db.prepare(`
      SELECT type, name
      FROM sqlite_schema
      WHERE type IN ('view', 'trigger') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      ORDER BY type, name
    `).all();
    assert(
      executableObjects.length === 0,
      `Downloaded catalog contains unsupported views or triggers: ${executableObjects.map((row) => `${row.type} ${row.name}`).join(", ")}.`,
    );

    const images = Number(db.prepare("SELECT COUNT(*) AS n FROM images").get().n);
    assert(images > 0, "Downloaded catalog contains no images.");
    const privateRows = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM images
      WHERE source_path IS NOT NULL OR gen_meta IS NOT NULL OR prompt_text IS NOT NULL
         OR ocr_text IS NOT NULL OR note IS NOT NULL OR mtime IS NOT NULL
         OR typeof(rel_path) <> 'text'
         OR rel_path <> printf('%d.webp', id)
         OR typeof(filename) <> 'text'
         OR filename <> printf('%d.webp', id)
         OR typeof(sha256) <> 'text'
         OR length(sha256) <> 64
         OR sha256 GLOB '*[^0-9a-f]*'
         OR typeof(bytes) <> 'integer' OR bytes <= 0
         OR typeof(width) <> 'integer' OR width <= 0
         OR typeof(height) <> 'integer' OR height <= 0
         OR format <> 'webp'
    `).get().n);
    assert(privateRows === 0, "Downloaded catalog is not a sanitized public snapshot.");
    assert(
      Number(db.prepare("SELECT COUNT(*) AS n FROM collections WHERE note IS NOT NULL").get().n) === 0,
      "Downloaded catalog still contains private collection notes.",
    );
    assert(
      Number(db.prepare("SELECT COUNT(*) AS n FROM links WHERE note IS NOT NULL").get().n) === 0,
      "Downloaded catalog still contains private link notes.",
    );
    const boundaryImages = db.prepare(`
      SELECT id, bytes FROM images
      WHERE id = (SELECT MIN(id) FROM images) OR id = (SELECT MAX(id) FROM images)
      ORDER BY id
    `).all().map((row) => ({ id: Number(row.id), bytes: Number(row.bytes) }));
    return { images, boundaryImages };
  } finally {
    db.close();
  }
}

async function verifyImageOrigin(blobBaseUrl, boundaryImages) {
  for (const image of boundaryImages) {
    const assetUrl = new URL(`/archive/images/${image.id}.webp`, blobBaseUrl);
    const response = await fetch(assetUrl, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `Public image ${image.id} is unavailable at the configured Blob origin (HTTP ${response.status}).`);
    assert(new URL(response.url).origin === blobBaseUrl.origin, `Public image ${image.id} resolved outside the configured Blob origin.`);
    assert(response.headers.get("content-type") === "image/webp", `Public image ${image.id} is not served as WebP.`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    assert(!contentLength || contentLength === image.bytes, `Public image ${image.id} does not match its catalog byte count.`);
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

  const archiveMode = process.env.ATLAS_ARCHIVE_MODE?.trim();
  assert(archiveMode === "public", "ATLAS_ARCHIVE_MODE must be exactly public.");

  const rawBlobBaseUrl = process.env.ATLAS_BLOB_BASE_URL?.trim();
  assert(rawBlobBaseUrl, "ATLAS_BLOB_BASE_URL is required.");
  const blobBaseUrl = new URL(rawBlobBaseUrl);
  assert(blobBaseUrl.protocol === "https:", "ATLAS_BLOB_BASE_URL must use HTTPS.");
  assert(!blobBaseUrl.username && !blobBaseUrl.password, "ATLAS_BLOB_BASE_URL must not contain credentials.");
  assert(
    blobBaseUrl.pathname === "/" && !blobBaseUrl.search && !blobBaseUrl.hash,
    "ATLAS_BLOB_BASE_URL must be an origin without a path, query, or fragment.",
  );

  const rawUrl = process.env.ATLAS_PUBLIC_DB_URL?.trim();
  assert(rawUrl, "ATLAS_PUBLIC_DB_URL is required.");
  const versionMatch = rawUrl.match(/\?v=([0-9a-f]{16})$/);
  assert(versionMatch, "ATLAS_PUBLIC_DB_URL must end with ?v=<16 lowercase hex characters>.");
  const expectedDigestPrefix = versionMatch[1];
  const url = new URL(rawUrl);
  assert(url.protocol === "https:", "ATLAS_PUBLIC_DB_URL must use HTTPS.");
  assert(!url.username && !url.password, "ATLAS_PUBLIC_DB_URL must not contain credentials.");
  assert(!url.hash, "ATLAS_PUBLIC_DB_URL must not contain a fragment.");
  const catalogMatch = url.pathname.match(/\/archive\/catalog\/([0-9a-f]{64})\.db$/);
  assert(catalogMatch, "ATLAS_PUBLIC_DB_URL must use a content-addressed archive catalog path.");
  assert(catalogMatch[1].startsWith(expectedDigestPrefix), "Catalog path and URL version disagree.");

  const destination = path.resolve(process.env.ATLAS_PUBLIC_DB_PATH || DEFAULT_DESTINATION);
  const maxBytes = Number(process.env.ATLAS_PUBLIC_DB_MAX_BYTES || 128 * 1024 * 1024);
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, "ATLAS_PUBLIC_DB_MAX_BYTES must be a positive integer.");
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  const tempPath = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let bytes = 0;
  const digest = crypto.createHash("sha256");
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    assert(response.ok, `Catalog download failed with HTTP ${response.status}.`);
    assert(response.body, "Catalog download returned an empty body.");
    const responseUrl = new URL(response.url);
    assert(responseUrl.protocol === "https:", "Catalog download redirected away from HTTPS.");
    assert(!responseUrl.username && !responseUrl.password, "Catalog download redirected to a URL containing credentials.");
    assert(
      responseUrl.origin === blobBaseUrl.origin,
      "ATLAS_BLOB_BASE_URL must match the final catalog response origin.",
    );
    const advertised = Number(response.headers.get("content-length") || 0);
    assert(!advertised || advertised <= maxBytes, "Published catalog exceeds the configured download limit.");

    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new Error("Published catalog exceeds the configured download limit."));
        else {
          digest.update(chunk);
          callback(null, chunk);
        }
      },
    });
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(tempPath, { flags: "wx" }));
    assert(bytes > 0, "Catalog download returned an empty file.");
    const downloadedDigest = digest.digest("hex");
    assert(
      downloadedDigest === catalogMatch[1] && downloadedDigest.startsWith(expectedDigestPrefix),
      `Catalog digest ${downloadedDigest.slice(0, 16)} does not match its content-addressed URL.`,
    );

    const tempHandle = await fsp.open(tempPath, "r+");
    try {
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    const verified = await verifyDatabase(tempPath);
    await verifyImageOrigin(blobBaseUrl, verified.boundaryImages);
    await replaceFile(tempPath, destination);
    console.log(`Fetched public archive: ${verified.images} images, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
  } finally {
    await fsp.rm(tempPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Public archive fetch failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
