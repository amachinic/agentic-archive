/**
 * Refine the keyterm vocabulary against lib/taxonomy.ts.
 *
 *   npm run refine-tags            # dry run: prints exactly what would change
 *   npm run refine-tags -- --apply # writes it (backs the database up first)
 *
 * Four passes:
 *   1. ASPECT  — rewrite frame-shape tags as tall/wide/square/panoramic from
 *      the stored dimensions, and strip the aspect-derived "portrait" and
 *      "landscape" links that were masquerading as subjects.
 *   2. MERGE   — fold plurals, spellings and over-specific phrases into their
 *      canonical term (chairs + chair -> furniture).
 *   3. RE-KIND — every surviving term takes its one canonical kind.
 *   4. PRUNE   — drop terms outside the vocabulary that describe a single
 *      image; their detail already lives in the description, which search reads.
 */
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "../lib/db";
import { canonical, KIND_OF, TAXONOMY } from "../lib/taxonomy";

const APPLY = process.argv.includes("--apply");
const conn = db();

type TagRow = { id: number; name: string; kind: string; c: number };

function tags(): TagRow[] {
  return conn.prepare(
    "SELECT t.id, t.name, t.kind, COUNT(it.image_id) AS c FROM tags t " +
    "LEFT JOIN image_tags it ON it.tag_id = t.id GROUP BY t.id ORDER BY c DESC"
  ).all() as TagRow[];
}

/** move every image link from one tag to another, then retire the source */
function mergeTag(fromId: number, toId: number) {
  conn.prepare(
    "INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) " +
    "SELECT image_id, ?, source FROM image_tags WHERE tag_id = ?"
  ).run(toId, fromId);
  conn.prepare("DELETE FROM image_tags WHERE tag_id = ?").run(fromId);
  conn.prepare("DELETE FROM tags WHERE id = ?").run(fromId);
}

function ensureTag(name: string, kind: string): number {
  const got = conn.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number } | undefined;
  if (got) {
    conn.prepare("UPDATE tags SET kind = ? WHERE id = ?").run(kind, got.id);
    return got.id;
  }
  const r = conn.prepare("INSERT INTO tags (name, kind) VALUES (?,?)").run(name, kind);
  return Number(r.lastInsertRowid);
}

function main() {
  const before = tags();
  console.log("vocabulary before: " + before.length + " terms\n");

  if (APPLY) {
    const backup = DB_PATH.replace(/\.db$/, "") + ".pre-refine.db";
    fs.copyFileSync(DB_PATH, backup);
    console.log("backup written: " + path.basename(backup) + "\n");
  }

  /* ---- 1. aspect: the frame's shape, computed, never guessed ---- */
  const ASPECT_OLD = ["portrait", "landscape", "square", "panoramic"];
  const analyzed = new Set(
    (conn.prepare("SELECT id FROM images WHERE ai_title IS NOT NULL").all() as { id: number }[]).map((r) => r.id),
  );
  const imgs = conn.prepare("SELECT id, width, height FROM images").all() as
    { id: number; width: number | null; height: number | null }[];

  let aspectFixed = 0, subjectFreed = 0;
  if (APPLY) {
    /* drop every aspect-derived link; portrait/landscape survive only where a
       model actually looked at the image and called it that */
    for (const nm of ASPECT_OLD) {
      const t = conn.prepare("SELECT id FROM tags WHERE name = ?").get(nm) as { id: number } | undefined;
      if (!t) continue;
      const links = conn.prepare("SELECT image_id FROM image_tags WHERE tag_id = ?").all(t.id) as { image_id: number }[];
      for (const l of links) {
        if (nm === "square" || nm === "panoramic" || !analyzed.has(l.image_id)) {
          conn.prepare("DELETE FROM image_tags WHERE tag_id = ? AND image_id = ?").run(t.id, l.image_id);
          if (nm === "portrait" || nm === "landscape") subjectFreed++;
        }
      }
      if (nm === "square" || nm === "panoramic") conn.prepare("DELETE FROM tags WHERE id = ?").run(t.id);
    }
    const ins = conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?,?,'ai')");
    const ids = Object.fromEntries(TAXONOMY.format.map((f) => [f, ensureTag(f, "format")]));
    for (const im of imgs) {
      if (!im.width || !im.height) continue;
      const ar = im.width / im.height;
      const shape = ar > 2 ? "panoramic" : ar > 1.15 ? "wide" : ar < 0.87 ? "tall" : "square";
      ins.run(im.id, ids[shape]);
      aspectFixed++;
    }
  } else {
    aspectFixed = imgs.filter((i) => i.width && i.height).length;
    subjectFreed = (conn.prepare(
      "SELECT COUNT(*) c FROM image_tags it JOIN tags t ON t.id = it.tag_id JOIN images i ON i.id = it.image_id " +
      "WHERE t.name IN ('portrait','landscape') AND i.ai_title IS NULL"
    ).get() as { c: number }).c;
  }
  console.log("1. ASPECT  " + aspectFixed + " images re-tagged tall/wide/square/panoramic");
  console.log("           " + subjectFreed + " false 'portrait'/'landscape' subject links removed\n");

  /* ---- 2 + 3. merge into canonical terms, and take the canonical kind ---- */
  const merges: string[] = [], rekinds: string[] = [], prunes: string[] = [];
  for (const t of before) {
    if (t.kind === "artist" || t.kind === "color") continue;      // curated elsewhere
    /* the old aspect words are freed above; only the NEW shape terms are
       exempt from re-kinding here */
    if (TAXONOMY.format.includes(t.name)) continue;
    const can = canonical(t.name);

    if (!can) {
      if (t.c <= 2) { prunes.push(t.name + " (" + t.c + ")"); if (APPLY) { conn.prepare("DELETE FROM image_tags WHERE tag_id = ?").run(t.id); conn.prepare("DELETE FROM tags WHERE id = ?").run(t.id); } }
      else console.log("   ? kept outside vocabulary: " + t.name + " (" + t.c + ")");
      continue;
    }
    if (can.name !== t.name) {
      merges.push(t.name + " -> " + can.name + " (" + t.c + ")");
      if (APPLY) mergeTag(t.id, ensureTag(can.name, can.kind));
    } else if (t.kind !== can.kind) {
      rekinds.push(t.name + ": " + t.kind + " -> " + can.kind);
      if (APPLY) conn.prepare("UPDATE tags SET kind = ? WHERE id = ?").run(can.kind, t.id);
    }
  }
  console.log("2. MERGE   " + merges.length + " terms folded into their category");
  merges.slice(0, 24).forEach((m) => console.log("           " + m));
  if (merges.length > 24) console.log("           ...and " + (merges.length - 24) + " more");
  console.log("\n3. RE-KIND " + rekinds.length + " terms took their canonical kind");
  rekinds.forEach((r) => console.log("           " + r));
  console.log("\n4. PRUNE   " + prunes.length + " one-off descriptions dropped (detail stays in the description)");
  console.log("           " + prunes.slice(0, 16).join(", ") + (prunes.length > 16 ? ", ..." : ""));

  /* orphans: nothing points at them any more */
  const orphans = conn.prepare(
    "SELECT t.id, t.name FROM tags t LEFT JOIN image_tags it ON it.tag_id = t.id WHERE it.tag_id IS NULL AND t.kind != 'artist'"
  ).all() as { id: number; name: string }[];
  if (APPLY) for (const o of orphans) conn.prepare("DELETE FROM tags WHERE id = ?").run(o.id);
  console.log("\n   ORPHANS " + orphans.length + " unused terms removed");

  if (APPLY) {
    const after = tags();
    const useful = after.filter((t) => t.c >= 2).length;
    console.log("\nvocabulary after: " + after.length + " terms (" + useful + " used by 2+ images)");
    console.log("by kind: " + JSON.stringify(
      conn.prepare("SELECT kind, COUNT(*) n FROM tags GROUP BY kind ORDER BY n DESC").all(),
    ));
  } else {
    console.log("\nDRY RUN. Nothing was written. Re-run with --apply to commit.");
  }
}

main();
