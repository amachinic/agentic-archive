/*
  The Registrar's pen.

  One call, one durable event. Kept deliberately tiny so no write path has an
  excuse not to record itself: recording must never be able to fail the
  action it describes, so this swallows its own errors -- a lost log line is
  bad, a folder that failed to save because logging hiccuped is worse.
*/
import { db, now } from "./db";

export type EventAgent = "archivist" | "curator" | "historian" | "media manager" | "registrar" | "you" | "system";

export function recordEvent(
  agent: EventAgent,
  action: string,
  detail?: Record<string, unknown>,
  imageId?: number | null,
): void {
  try {
    db().prepare("INSERT INTO events (at, agent, action, image_id, detail) VALUES (?,?,?,?,?)")
      .run(now(), agent, action, imageId ?? null, detail ? JSON.stringify(detail).slice(0, 2000) : null);
  } catch {
    /* never let the ledger take the action down with it */
  }
}

/*
  What the Historian's own record teaches.

  Every outside probe is recorded (action "probe": query, found, added). This
  reads that record back as the two lists a planner actually wants: the probes
  that YIELDED, and the probes that came back EMPTY — so the next hunt starts
  from what this archive's sources have already answered, instead of
  rediscovering the same dead words. This is the evolving half of the loop:
  the writer above is the diary, this is the re-reading of it.

  Same contract as the writer: it must never take the caller down, and in the
  read-only builds (no database) it simply remembers nothing.
*/
export function probeMemory(): { rich: Array<{ q: string; added: number }>; dry: string[] } {
  try {
    const rows = db().prepare(
      "SELECT detail FROM events WHERE agent = 'historian' AND action = 'probe' ORDER BY at DESC LIMIT 400",
    ).all() as Array<{ detail: string | null }>;
    const byQ = new Map<string, { added: number; tries: number }>();
    for (const r of rows) {
      if (!r.detail) continue;
      let d: { q?: unknown; added?: unknown };
      try { d = JSON.parse(r.detail); } catch { continue; }
      const q = typeof d.q === "string" ? d.q.toLowerCase().trim() : "";
      if (!q) continue;
      const cur = byQ.get(q) ?? { added: 0, tries: 0 };
      cur.added += typeof d.added === "number" ? d.added : 0;
      cur.tries += 1;
      byQ.set(q, cur);
    }
    const all = [...byQ.entries()];
    return {
      rich: all.filter(([, v]) => v.added > 0)
        .sort((a, b) => b[1].added - a[1].added)
        .slice(0, 8)
        .map(([q, v]) => ({ q, added: v.added })),
      dry: all.filter(([, v]) => v.added === 0 && v.tries >= 2)
        .slice(0, 8)
        .map(([q]) => q),
    };
  } catch {
    return { rich: [], dry: [] };
  }
}
