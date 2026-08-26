import { db } from "@/lib/db";

/** GET ?a=&b= -> the most recent stored comparison for the pair, either order. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const a = Number(u.searchParams.get("a"));
  const b = Number(u.searchParams.get("b"));
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    return Response.json({ error: "a and b required" }, { status: 400 });
  }
  const row = db().prepare(
    "SELECT body, model, created_at FROM comparisons " +
    "WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?) ORDER BY created_at DESC LIMIT 1"
  ).get(a, b, b, a) as { body: string; model: string; created_at: number } | undefined;
  if (!row) return Response.json({ comparison: null });
  return Response.json({ comparison: JSON.parse(row.body), model: row.model, at: row.created_at });
}
