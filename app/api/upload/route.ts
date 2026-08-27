import fsp from "node:fs/promises";
import { recordEvent } from "@/lib/events";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ensureCollection, ingestFile, rebuildSimilarity, IMAGE_RE } from "@/lib/ingest";

export const maxDuration = 120;

/** Upload one image into the library (lands in the Uploads collection). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  if (!IMAGE_RE.test(file.name)) return Response.json({ error: "not an image file" }, { status: 400 });
  if (file.size > 80 * 1024 * 1024) return Response.json({ error: "file too large" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const tmp = path.join(os.tmpdir(), "atlas-upload-" + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_"));
  await fsp.writeFile(tmp, buf);
  try {
    const collectionId = ensureCollection("Uploads");
    const r = await ingestFile(tmp, collectionId);
    // the temp path is meaningless as provenance; record the original name
    if (r.status === "added") {
      db().prepare("UPDATE images SET source_path = ? WHERE id = ?").run("upload: " + file.name, r.id);
    }
    rebuildSimilarity();
    recordEvent("you", "ingest", { filename: file.name, bytes: file.size, status: r.status }, r.id);
    return Response.json({ id: r.id, status: r.status });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "ingest failed" }, { status: 500 });
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
}
