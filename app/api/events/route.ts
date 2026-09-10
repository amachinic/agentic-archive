import { db } from "@/lib/db";
import { IS_HOSTED_READ_ONLY } from "@/lib/runtime";

/*
  The ledger, read back. The events table was built so the archive's history
  would stop evaporating with the tab -- and then the History panel went on
  reading only the session list, so 629 durable rows were never shown to
  anyone. This is the read side: the newest events, small, for the panel.

  Local only. The hosted copy has no ledger to show (the publisher drops the
  table), and the middleware refuses the route there anyway; the panel falls
  back to the session list.
*/
export async function GET(req: Request) {
  if (IS_HOSTED_READ_ONLY) return Response.json({ events: [] });
  const u = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 60)));
  const rows = db().prepare(
    "SELECT e.id, e.at, e.agent, e.action, e.image_id, e.detail, i.ai_title AS title " +
    "FROM events e LEFT JOIN images i ON i.id = e.image_id ORDER BY e.at DESC, e.id DESC LIMIT ?"
  ).all(limit) as { id: number; at: number; agent: string; action: string; image_id: number | null; detail: string | null; title: string | null }[];
  return Response.json({
    events: rows.map((r) => {
      let detail: Record<string, unknown> = {};
      try { detail = r.detail ? JSON.parse(r.detail) : {}; } catch { /* a truncated row still lists */ }
      return { id: r.id, at: r.at, agent: r.agent, action: r.action, imageId: r.image_id, title: r.title, detail };
    }),
  });
}
