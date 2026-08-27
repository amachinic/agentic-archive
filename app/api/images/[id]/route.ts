import fsp from "node:fs/promises";
import { recordEvent } from "@/lib/events";
import path from "node:path";
import { db, LIBRARY_DIR, THUMB_DIR } from "@/lib/db";
import { getImage } from "@/lib/queries";

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
    const name = body.addTag.trim().toLowerCase();
    const t = conn.prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=name RETURNING id").get(name) as { id: number };
    conn.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?,?,'manual')").run(id, t.id);
  }
  if (body.removeTagId) {
    conn.prepare("DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?").run(id, body.removeTagId);
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
