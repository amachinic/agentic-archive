/*
  The Registrar's pen.

  One call, one durable event. Kept deliberately tiny so no write path has an
  excuse not to record itself: recording must never be able to fail the
  action it describes, so this swallows its own errors -- a lost log line is
  bad, a folder that failed to save because logging hiccuped is worse.
*/
import { db, now } from "./db";

export type EventAgent = "archivist" | "curator" | "media manager" | "registrar" | "you" | "system";

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
