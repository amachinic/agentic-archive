import { listConnections, SOURCE_BY_ID, type SourceId } from "@/lib/connections";
import { searchConnected } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * GET /api/sources/search?q=…&limit=…&source=…
 *
 * Searches every CONNECTED source at once and returns normalised candidates.
 * The work happens in lib/sources.ts (searchConnected) — the same call the
 * agent's search_outside tool makes, so a search means one thing everywhere.
 *
 * Nothing here writes. Candidates are a pool to look at, and the archive is
 * only ever written through an accepted proposal.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const only = url.searchParams.get("source") as SourceId | null;
  const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 12));
  if (!q) return Response.json({ error: "a query is required" }, { status: 400 });

  if (only && !listConnections().some((c) => c.id === only && c.status !== "off")) {
    return Response.json({ error: "that source is not connected" }, { status: 400 });
  }
  if (!listConnections().some((c) => c.status !== "off")) {
    return Response.json({ error: "no sources are connected yet" }, { status: 400 });
  }

  const { results, searched, failed } = await searchConnected(q, { limit, only });

  return Response.json({
    query: q,
    searched: searched.length,
    found: results.length,
    keepable: results.filter((r) => r.keepable).length,
    results,
    failed: failed.map((f) => ({ ...f, name: SOURCE_BY_ID.get(f.source)?.name ?? f.source })),
  });
}
