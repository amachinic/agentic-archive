import { listConnections, enable, disconnect, noteError, SOURCE_BY_ID, type SourceId } from "@/lib/connections";
import { ADAPTERS, reason } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/connections -> what is on, what is missing a credential */
export async function GET() {
  return Response.json({ connections: listConnections() });
}

/**
 * POST /api/connections { source, action: "enable" | "disable" }
 *
 * Enabling is not a row write. It is a real call to the source, and the row is
 * only written if that call came back. Anything else would let this page claim
 * a connection it has never once proved.
 *
 * OAuth sources are connected at /api/connect/<source>; a switch cannot stand
 * in for an authorisation.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { source?: string; action?: string } | null;
  const id = String(body?.source ?? "") as SourceId;
  const def = SOURCE_BY_ID.get(id);
  if (!def) return Response.json({ error: "unknown source" }, { status: 400 });

  if (body?.action === "disable") {
    disconnect(id);
    return Response.json({ ok: true, connections: listConnections() });
  }

  if (def.auth === "oauth") {
    return Response.json(
      { error: def.name + " needs an account authorisation, not a switch" },
      { status: 400 },
    );
  }

  const missing = def.env.filter((v) => !process.env[v]?.trim());
  if (missing.length) {
    return Response.json(
      { error: "Set " + missing.join(" and ") + " in .env.local, then restart the server." },
      { status: 400 },
    );
  }

  /* The actual proof. */
  try {
    const probe = await ADAPTERS[id].probe();
    enable(id, probe.account ?? null, probe.detail);
    return Response.json({
      ok: true,
      message: def.name + " connected · " + probe.detail,
      connections: listConnections(),
    });
  } catch (e) {
    const why = reason(e);
    noteError(id, why);
    return Response.json(
      { error: def.name + " did not answer: " + why, connections: listConnections() },
      { status: 502 },
    );
  }
}
