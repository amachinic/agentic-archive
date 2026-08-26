import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
export const LIBRARY_DIR = path.join(ROOT, "library");
export const THUMB_DIR = path.join(ROOT, ".cache", "thumbs");
export const DB_PATH = path.join(ROOT, "atlas.db");

for (const d of [LIBRARY_DIR, THUMB_DIR]) fs.mkdirSync(d, { recursive: true });

let _db: DatabaseSync | null = null;

/**
 * One connection per process. Next dev reloads modules, so the instance is
 * parked on globalThis: a second DatabaseSync against the same file would
 * otherwise fight the first for the write lock on every hot reload.
 */
export function db(): DatabaseSync {
  const g = globalThis as unknown as { __atlasDb?: DatabaseSync };
  if (g.__atlasDb) return g.__atlasDb;
  if (_db) return _db;
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  migrate(conn);
  _db = conn;
  g.__atlasDb = conn;
  return conn;
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      parent_id    INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      slug         TEXT NOT NULL,
      note         TEXT,
      created_at   INTEGER NOT NULL,
      UNIQUE(parent_id, slug)
    );

    CREATE TABLE IF NOT EXISTS images (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      -- path inside the managed library, relative to LIBRARY_DIR
      rel_path      TEXT NOT NULL UNIQUE,
      filename      TEXT NOT NULL,
      -- where it was copied FROM, kept so re-ingest can skip and so the
      -- original is always traceable. Originals are never modified.
      source_path   TEXT,
      sha256        TEXT NOT NULL,
      bytes         INTEGER NOT NULL,
      width         INTEGER,
      height        INTEGER,
      format        TEXT,
      -- 64-bit DCT perceptual hash as a 16-char hex string
      phash         TEXT,
      -- 27-bin (3x3x3) RGB histogram, JSON array of floats, L1-normalised
      histogram     TEXT,
      palette       TEXT,   -- JSON: [{hex,r,g,b,pct}]
      dominant_hex  TEXT,
      -- mean luminance 0..1 and colorfulness, for sorting/filtering
      luma          REAL,
      chroma        REAL,
      -- ComfyUI / EXIF sidecar data lifted out of the PNG text chunks
      gen_meta      TEXT,
      prompt_text   TEXT,
      ai_title      TEXT,
      ai_description TEXT,
      ai_analysis   TEXT,   -- JSON: full structured vision response
      ai_model      TEXT,
      ai_at         INTEGER,
      rating        INTEGER NOT NULL DEFAULT 0,   -- 0..5, your cull signal
      flagged       INTEGER NOT NULL DEFAULT 0,   -- 1 = keep/hero, -1 = reject
      note          TEXT,
      created_at    INTEGER NOT NULL,
      mtime         INTEGER
    );

    CREATE TABLE IF NOT EXISTS tags (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL UNIQUE,
      kind   TEXT NOT NULL DEFAULT 'tag',  -- tag | subject | style | color | medium | mood
      color  TEXT
    );

    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      source   TEXT NOT NULL DEFAULT 'manual',  -- manual | ai
      weight   REAL NOT NULL DEFAULT 1,
      PRIMARY KEY (image_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS image_collections (
      image_id      INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      added_at      INTEGER NOT NULL,
      PRIMARY KEY (image_id, collection_id)
    );

    -- Obsidian-style explicit links: directed, annotated, and surfaced as
    -- backlinks on the far end.
    CREATE TABLE IF NOT EXISTS links (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'relates',  -- relates | iteration | derives | contrast
      note       TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(from_id, to_id, kind)
    );

    -- Cached pairwise visual similarity so the graph does not recompute
    -- an O(n^2) sweep on every request.
    CREATE TABLE IF NOT EXISTS similarity (
      a_id     INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      b_id     INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      phash_d  INTEGER NOT NULL,   -- hamming distance 0..64
      color_d  REAL NOT NULL,      -- histogram distance 0..1
      score    REAL NOT NULL,      -- combined 0..1, higher = more alike
      PRIMARY KEY (a_id, b_id)
    );

    -- pairs the user has explicitly disconnected: derived wires
    -- (similarity / shared-keyterm) between them are never shown again
    CREATE TABLE IF NOT EXISTS edge_hides (
      a_id INTEGER NOT NULL,
      b_id INTEGER NOT NULL,
      PRIMARY KEY (a_id, b_id)
    );

    CREATE TABLE IF NOT EXISTS comparisons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      a_id       INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      b_id       INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      verdict    TEXT,
      body       TEXT,
      model      TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_img_phash    ON images(phash);
  `);

  // additive columns (ALTER throws if the column exists; that is fine)
  for (const ddl of [
    "ALTER TABLE images ADD COLUMN ocr_text TEXT",   // local OCR pass
    "ALTER TABLE images ADD COLUMN local_at INTEGER", // local tagging marker
    "ALTER TABLE images ADD COLUMN ocr_refined INTEGER", // text-classification marker
    "ALTER TABLE images ADD COLUMN artist TEXT",          // identified creator
    "ALTER TABLE images ADD COLUMN artist_at INTEGER",    // identification marker
  ]) {
    try { conn.exec(ddl); } catch { /* already there */ }
  }

  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_img_sha      ON images(sha256);
    CREATE INDEX IF NOT EXISTS idx_img_rating   ON images(rating);
    CREATE INDEX IF NOT EXISTS idx_sim_a        ON similarity(a_id, score DESC);
    CREATE INDEX IF NOT EXISTS idx_sim_b        ON similarity(b_id, score DESC);
    CREATE INDEX IF NOT EXISTS idx_it_tag       ON image_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_ic_coll      ON image_collections(collection_id);
    CREATE INDEX IF NOT EXISTS idx_links_from   ON links(from_id);
    CREATE INDEX IF NOT EXISTS idx_links_to     ON links(to_id);
  `);
}

export function now() {
  return Date.now();
}
