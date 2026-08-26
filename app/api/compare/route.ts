import { db } from "@/lib/db";
import { demoComparison } from "@/lib/demo";
import { IS_HOSTED_DEMO } from "@/lib/runtime";

/** GET ?a=&b= -> the most recent stored comparison for the pair, either order. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const a = Number(u.searchParams.get("a"));
  const b = Number(u.searchParams.get("b"));
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    return Response.json({ error: "a and b required" }, { status: 400 });
  }
  if (IS_HOSTED_DEMO) {
    return Response.json({
      comparison: demoComparison(a, b),
      model: "curated demo comparison",
      at: Date.UTC(2026, 7, 20),
    });
  }
  const row = db().prepare(
    "SELECT body, model, created_at FROM comparisons " +
    "WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?) ORDER BY created_at DESC LIMIT 1"
  ).get(a, b, b, a) as { body: string; model: string; created_at: number } | undefined;
  if (!row) return Response.json({ comparison: null });
  return Response.json({ comparison: JSON.parse(row.body), model: row.model, at: row.created_at });
}
