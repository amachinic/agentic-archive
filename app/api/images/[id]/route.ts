import fsp from "node:fs/promises";
import { recordEvent } from "@/lib/events";
import path from "node:path";
import { db, LIBRARY_DIR, THUMB_DIR } from "@/lib/db";
import { getImage } from "@/lib/queries";
import { canonical } from "@/lib/taxonomy";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const img = getImage(Number(id));
  if (!img) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(img);
}

/** PATCH: rating / flag / note / manual tags. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  const body = await req.json().catch(() => null) as
    { rating?: number; flagged?: number; note?: string; addTag?: string; removeTagId?: number } | null;
  if (!body) return Response.json({ error: "bad body" }, { status: 400 });

  const conn = db();
  const exists = conn.prepare("SELECT id FROM images WHERE id = ?").get(id);
  if (!exists) return Response.json({ error: "not found" }, { status: 404 });

  if (typeof body.rating === "number") {
    conn.prepare("UPDATE images SET rating = ? WHERE id = ?").run(Math.max(0, Math.min(5, body.rating)), id);
  }
  if (typeof body.flagged === "number") {
    conn.prepare("UPDATE images SET flagged = ? WHERE id = ?").run(Math.max(-1, Math.min(1, body.flagged)), id);
  }
  if (body.note !== undefined) {
    conn.prepare("UPDATE images SET note = ? WHERE id = ?").run(body.note, id);
  }
  if (body.addTag?.trim()) {
    /* A hand-typed keyterm goes through the same vocabulary as a model's:
       "Poster" is the work value poster, and a work, carrier or period
       REPLACES the one the image has -- typing poster onto a book cover
       used to leave the image carrying both, measured. A word outside the
       vocabulary is kept as the person's own tag (kind 'tag'). */
    const raw = body.addTag.trim().toLowerCase();
    const can = canonical(raw);
    const name = can ? can.name : raw;
    const kind = can ? can.kind : "tag";
    if (["work", "carrier", "period"].includes(kind)) {
      conn.prepare("DELETE FROM image_tags WHERE image_id = ? AND tag_id IN (SELECT id FROM tags WHERE kind = ?)").run(id, kind);
    }
    const t = conn.prepare("INSERT INTO tags (name, kind) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET name=name RETURNING id").get(name, kind) as { id: number };
    conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?,?,'manual')").run(id, t.id);
    recordEvent("you", "tag", { name, kind, typed: raw !== name ? raw : undefined }, id);
  }
  if (body.removeTagId) {
    const gone = conn.prepare("SELECT name, kind FROM tags WHERE id = ?").get(body.removeTagId) as { name: string; kind: string } | undefined;
    conn.prepare("DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?").run(id, body.removeTagId);
    if (gone) recordEvent("you", "untag", { name: gone.name, kind: gone.kind }, id);
  }
  return Response.json(getImage(id));
}

/** DELETE: remove from the library entirely (managed copy + thumb + rows). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  const conn = db();
  const row = conn.prepare("SELECT rel_path FROM images WHERE id = ?").get(id) as { rel_path: string } | undefined;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  conn.prepare("DELETE FROM images WHERE id = ?").run(id);
  await fsp.unlink(path.join(LIBRARY_DIR, row.rel_path)).catch(() => {});
  await fsp.unlink(path.join(THUMB_DIR, id + ".webp")).catch(() => {});
  recordEvent("you", "delete", { rel_path: row.rel_path }, id);
  return Response.json({ ok: true });
}
