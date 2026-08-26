import { db, now } from "@/lib/db";

/** Manual Obsidian-style links between images. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { fromId?: number; toId?: number; kind?: string; note?: string } | null;
  if (!body?.fromId || !body?.toId || body.fromId === body.toId) {
    return Response.json({ error: "fromId and toId required" }, { status: 400 });
  }
  const kind = ["relates", "iteration", "derives", "contrast"].includes(body.kind ?? "") ? body.kind! : "relates";
  db().prepare(
    "INSERT INTO links (from_id, to_id, kind, note, created_at) VALUES (?,?,?,?,?) " +
    "ON CONFLICT(from_id, to_id, kind) DO UPDATE SET note = excluded.note"
  ).run(body.fromId, body.toId, kind, body.note ?? null, now());
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });
  db().prepare("DELETE FROM links WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
