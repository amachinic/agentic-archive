import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db, LIBRARY_DIR } from "@/lib/db";

/*
  The Media Manager's disk door: mirror an Atlas folder to real files under
  ~/Atlas Exports/<name>. Copies only — originals in the managed library are
  never touched, and nothing in the database changes. Capped so one tap can
  never ship the whole archive by accident.
*/

/* A ceiling, not a limit. The client asks before anything large (see the
   confirm in GraphView), so this exists to stop a malformed or hostile request
   writing the whole disk, not to argue with a person who narrowed the field to
   450 on purpose and meant it. */
const MAX_FILES = 2000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { collectionId?: number; name?: string; ids?: number[]; list?: boolean; open?: boolean } | null;
  const conn = db();

  /* two sources of truth: a saved folder, or a bare set of ids (what is on
     the canvas right now, which belongs to no folder yet) */
  let label: string;
  let rows: { id: number; rel_path: string; filename: string }[];

  const rawIds = Array.isArray(body?.ids) ? body.ids.filter((n) => Number.isInteger(n)) : null;
  if (rawIds?.length) {
    const ph = rawIds.map(() => "?").join(",");
    rows = conn.prepare(
      "SELECT id, rel_path, filename FROM images WHERE id IN (" + ph + ") ORDER BY id"
    ).all(...rawIds) as typeof rows;
    label = (body?.name || "Canvas").trim();
  } else {
    const col = body?.collectionId != null
      ? conn.prepare("SELECT id, name FROM collections WHERE id = ?").get(Number(body.collectionId)) as { id: number; name: string } | undefined
      : body?.name
        ? conn.prepare("SELECT id, name FROM collections WHERE name = ? COLLATE NOCASE").get(String(body.name)) as { id: number; name: string } | undefined
        : undefined;
    if (!col) return Response.json({ error: "folder not found" }, { status: 404 });
    rows = conn.prepare(
      "SELECT i.id, i.rel_path, i.filename FROM images i JOIN image_collections ic ON ic.image_id = i.id WHERE ic.collection_id = ? ORDER BY i.id"
    ).all(col.id) as typeof rows;
    label = col.name;
  }

  if (!rows.length) return Response.json({ error: "there is nothing to save" }, { status: 400 });
  if (rows.length > MAX_FILES) {
    return Response.json({ error: rows.length + " files · the disk door caps at " + MAX_FILES }, { status: 400 });
  }

  /* list mode: the browser writes the files itself into a folder the human
     picked with the native dialog; it only needs to know what to fetch */
  if (body?.list) {
    return Response.json({ name: label, files: rows.map((r) => ({ id: r.id, filename: r.filename })) });
  }

  const safe = label.replace(/[<>:"/\\|?*]/g, "-").trim() || "Untitled";
  const dest = path.join(os.homedir(), "Atlas Exports", safe);
  fs.mkdirSync(dest, { recursive: true });

  let copied = 0;
  for (const r of rows) {
    const src = path.join(LIBRARY_DIR, r.rel_path);
    if (!fs.existsSync(src)) continue;
    const out = path.join(dest, r.filename);
    if (!fs.existsSync(out)) fs.copyFileSync(src, out);
    copied++;
  }

  /* the folder opens in Explorer so the files are in hand, not just claimed */
  if (body?.open) {
    try { spawn("explorer", [dest], { detached: true, stdio: "ignore" }).unref(); } catch { /* headless */ }
  }

  return Response.json({ name: label, path: dest, count: copied });
}
