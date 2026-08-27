import { db, now } from "@/lib/db";
import { ensureCollection } from "@/lib/ingest";
import { collectionTree, type CollectionNode } from "@/lib/queries";
import { recordEvent } from "@/lib/events";

/** GET: the folder tree, flattened with depth (for client-side pickers). */
export async function GET() {
  const flatten = (nodes: CollectionNode[], depth = 0): { id: number; name: string; depth: number }[] =>
    nodes.flatMap((n) => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)]);
  return Response.json({ collections: flatten(collectionTree()) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { name?: string; parentId?: number | null } | null;
  const name = body?.name?.trim();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const id = ensureCollection(name, body?.parentId ?? null);
  recordEvent("you", "folder-create", { name, id, parentId: body?.parentId ?? null });
  return Response.json({ id });
}

/** PATCH: rename or move. DELETE: remove collection (images stay in the library). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null) as { id?: number; name?: string; note?: string } | null;
  if (!body?.id) return Response.json({ error: "id required" }, { status: 400 });
  const conn = db();
  if (body.name?.trim()) conn.prepare("UPDATE collections SET name = ? WHERE id = ?").run(body.name.trim(), body.id);
  if (body.note !== undefined) conn.prepare("UPDATE collections SET note = ? WHERE id = ?").run(body.note, body.id);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });
  const gone = db().prepare("SELECT name FROM collections WHERE id = ?").get(id) as { name: string } | undefined;
  db().prepare("DELETE FROM collections WHERE id = ?").run(id);
  recordEvent("you", "folder-delete", { id, name: gone?.name });
  return Response.json({ ok: true });
}

/** PUT: add/remove images to a collection. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null) as
    { collectionId?: number; imageIds?: number[]; action?: "add" | "remove" } | null;
  if (!body?.collectionId || !Array.isArray(body.imageIds)) {
    return Response.json({ error: "collectionId and imageIds required" }, { status: 400 });
  }
  const conn = db();
  if (body.action === "remove") {
    const del = conn.prepare("DELETE FROM image_collections WHERE image_id = ? AND collection_id = ?");
    for (const i of body.imageIds) del.run(i, body.collectionId);
    recordEvent("you", "unfile", { collectionId: body.collectionId, images: body.imageIds.length });
  } else {
    const ins = conn.prepare("INSERT OR IGNORE INTO image_collections (image_id, collection_id, added_at) VALUES (?,?,?)");
    for (const i of body.imageIds) ins.run(i, body.collectionId, now());
    recordEvent("you", "file", { collectionId: body.collectionId, images: body.imageIds.length });
  }
  return Response.json({ ok: true });
}
