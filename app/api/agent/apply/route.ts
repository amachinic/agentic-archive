import { db, now } from "@/lib/db";
import { ensureCollection } from "@/lib/ingest";
import { recordEvent } from "@/lib/events";

/*
  Commit an ACCEPTED agent proposal: create (or reuse) the folder and file
  the images. This is the only place agent intentions become writes.
*/
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { name?: string; ids?: number[] } | null;
  const name = String(body?.name ?? "").trim().slice(0, 60);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((n) => Number.isInteger(n)).slice(0, 1200) : [];
  if (!name || !ids.length) return Response.json({ error: "name and ids required" }, { status: 400 });

  const conn = db();
  const collectionId = ensureCollection(name);
  const ins = conn.prepare("INSERT OR IGNORE INTO image_collections (image_id, collection_id, added_at) VALUES (?, ?, ?)");
  let filed = 0;
  for (const id of ids) {
    const r = ins.run(id, collectionId, now());
    filed += Number(r.changes);
  }
  /* the accept is a human judgement about agent work: exactly the stream a
     future fine-tune learns from, so it is the first thing the ledger keeps */
  recordEvent("you", "accept", { proposal: name, proposed: ids.length, filed });
  recordEvent("media manager", "file", { collection: name, collectionId, filed });
  return Response.json({ collectionId, filed, name });
}
