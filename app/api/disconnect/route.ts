import { db } from "@/lib/db";

/**
 * POST { a, b, kind } — sever the connection between two images.
 *  manual              -> the link rows are deleted
 *  similarity | tag    -> the pair is recorded as hidden, so derived wires
 *                         between them never render again
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { a?: number; b?: number; kind?: string } | null;
  const a = Number(body?.a), b = Number(body?.b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    return Response.json({ error: "a and b required" }, { status: 400 });
  }
  const conn = db();
  if (body?.kind === "manual") {
    conn.prepare("DELETE FROM links WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").run(a, b, b, a);
  } else {
    conn.prepare("INSERT OR IGNORE INTO edge_hides (a_id, b_id) VALUES (?, ?)").run(Math.min(a, b), Math.max(a, b));
  }
  return Response.json({ ok: true });
}
