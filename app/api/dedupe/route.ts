import fsp from "node:fs/promises";
import { recordEvent } from "@/lib/events";
import path from "node:path";
import { db, LIBRARY_DIR, THUMB_DIR } from "@/lib/db";
import { rebuildSimilarity } from "@/lib/ingest";

/*
  Duplicate resolution. Exact byte-duplicates never enter the library (sha256
  dedupe at ingest), so what remains are re-encodes and re-exports of the same
  picture: same structure, same colour, different bytes. Those are pairs with
  a near-zero perceptual-hash distance AND near-zero colour distance AND the
  same aspect ratio. Clusters are built with union-find; the highest-resolution
  copy (ties: larger file) survives, the rest are removed from the managed
  library. Source originals are never touched.
*/

type Img = { id: number; w: number | null; h: number | null; bytes: number; filename: string; rel_path: string; flagged: number };

function findDupeGroups() {
  const conn = db();
  const pairs = conn.prepare(
    "SELECT a_id, b_id FROM similarity WHERE phash_d <= 2 AND color_d <= 0.05"
  ).all() as { a_id: number; b_id: number }[];
  const imgs = new Map(
    (conn.prepare("SELECT id, width AS w, height AS h, bytes, filename, rel_path, flagged FROM images").all() as Img[])
      .map((r) => [r.id, r])
  );

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression
    let c = x;
    while (parent.get(c) !== r) { const nxt = parent.get(c)!; parent.set(c, r); c = nxt; }
    return r;
  };
  const union = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const p of pairs) {
    const a = imgs.get(p.a_id), b = imgs.get(p.b_id);
    if (!a || !b || !a.w || !a.h || !b.w || !b.h) continue;
    // same picture re-exported keeps its aspect; different flat-dark artworks
    // that collide on pHash usually do not.
    const ra = a.w / a.h, rb = b.w / b.h;
    if (Math.abs(ra - rb) / Math.max(ra, rb) > 0.02) continue;
    union(p.a_id, p.b_id);
  }

  const groups = new Map<number, Img[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(imgs.get(id)!);
  }

  const result: { keep: Img; remove: Img[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      // a kept/flagged image always survives over an unflagged twin
      if ((b.flagged === 1 ? 1 : 0) !== (a.flagged === 1 ? 1 : 0)) return (b.flagged === 1 ? 1 : 0) - (a.flagged === 1 ? 1 : 0);
      const areaA = (a.w ?? 0) * (a.h ?? 0), areaB = (b.w ?? 0) * (b.h ?? 0);
      if (areaB !== areaA) return areaB - areaA;
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.id - b.id;
    });
    result.push({ keep: sorted[0], remove: sorted.slice(1) });
  }
  return result;
}

/** Dry run: report what would be removed. */
export async function GET() {
  const groups = findDupeGroups();
  const removeCount = groups.reduce((n, g) => n + g.remove.length, 0);
  return Response.json({
    groups: groups.length,
    duplicates: removeCount,
    sample: groups.slice(0, 6).map((g) => ({
      keep: g.keep.filename,
      remove: g.remove.map((r) => r.filename),
    })),
  });
}

/** Execute: delete the losing copies and rebuild the similarity cache. */
export async function POST() {
  const conn = db();
  const groups = findDupeGroups();
  let removed = 0;
  for (const g of groups) {
    for (const r of g.remove) {
      conn.prepare("DELETE FROM images WHERE id = ?").run(r.id);
      await fsp.unlink(path.join(LIBRARY_DIR, r.rel_path)).catch(() => {});
      await fsp.unlink(path.join(THUMB_DIR, r.id + ".webp")).catch(() => {});
      removed++;
    }
  }
  const sim = removed ? rebuildSimilarity() : null;
  recordEvent("archivist", "dedupe", { removed, groups: groups.length });
  return Response.json({ removed, groups: groups.length, similarity: sim });
}
