/*
  What the archive is allowed to look at, and who it looks as.

  Two kinds of source, and the difference is the whole reason this file exists.
  An open collection needs nothing: switching it on is a row saying 'enabled'.
  A platform needs YOUR account, and connecting means an OAuth round trip whose
  token has to be kept somewhere the browser cannot reach.

  Nothing here reaches the network. This module owns state; the routes own the
  round trips.
*/
import { db, now } from "./db";
import { recordEvent } from "./events";

export type SourceId =
  | "arena" | "pinterest"
  | "rijks" | "met" | "artic" | "cleveland" | "europeana";

/** what a source needs before it will answer */
export type Auth = "none" | "key" | "oauth";

export type SourceDef = {
  id: SourceId;
  name: string;
  auth: Auth;
  /** env vars that must be present before the source can be used */
  env: string[];
};

/* The registry is deliberately server-side: the client renders what this
   says, so a source cannot appear in the UI without a definition behind it. */
export const SOURCES: SourceDef[] = [
  /* Are.na and the Rijksmuseum are keyless, measured rather than assumed: the
     Rijksmuseum's key-based API now answers 410 and its replacement asks for
     nothing, and Are.na's open endpoints cover channels and their contents. */
  { id: "arena", name: "Are.na", auth: "none", env: [] },
  { id: "pinterest", name: "Pinterest", auth: "oauth", env: ["ATLAS_PINTEREST_APP_ID", "ATLAS_PINTEREST_SECRET"] },
  { id: "rijks", name: "Rijksmuseum", auth: "none", env: [] },
  { id: "met", name: "The Met", auth: "none", env: [] },
  { id: "artic", name: "Art Institute of Chicago", auth: "none", env: [] },
  { id: "cleveland", name: "Cleveland Museum of Art", auth: "none", env: [] },
  { id: "europeana", name: "Europeana", auth: "key", env: ["ATLAS_EUROPEANA_KEY"] },
];

export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export type ConnectionState = {
  id: SourceId;
  status: "off" | "enabled" | "connected";
  account: string | null;
  /** every env var this source needs is present in the process */
  ready: boolean;
  /** the ones that are missing, so the UI can name them */
  missing: string[];
  /** what the source itself said on the probe that connected it */
  detail: string | null;
  lastError: string | null;
};

type Row = {
  source: string; status: string; account: string | null;
  expires_at: number | null; last_error: string | null; detail: string | null;
};

export function listConnections(): ConnectionState[] {
  const rows = db().prepare(
    "SELECT source, status, account, expires_at, last_error, detail FROM connections"
  ).all() as Row[];
  const bySource = new Map(rows.map((r) => [r.source, r]));

  return SOURCES.map((def) => {
    const row = bySource.get(def.id);
    const missing = def.env.filter((v) => !process.env[v]?.trim());
    /* An expired OAuth token is not a connection. Saying 'connected' over a
       token that will 401 on first use is the kind of lie a settings page
       must never tell. */
    const expired = !!row?.expires_at && row.expires_at < now();
    const status: ConnectionState["status"] =
      !row || expired ? "off" : (row.status === "connected" ? "connected" : "enabled");
    return {
      id: def.id,
      status,
      account: row?.account ?? null,
      ready: missing.length === 0,
      missing,
      detail: row?.detail ?? null,
      lastError: expired ? "the authorisation expired — connect again" : row?.last_error ?? null,
    };
  });
}

/**
 * Record a source as reachable. Only ever called AFTER a real probe returned,
 * so `detail` is something the source actually said about itself.
 */
export function enable(id: SourceId, account: string | null, detail: string): void {
  db().prepare(
    "INSERT INTO connections (source, status, account, detail, connected_at, last_error)" +
    " VALUES (?,?,?,?,?,NULL)" +
    " ON CONFLICT(source) DO UPDATE SET status=excluded.status, account=excluded.account," +
    " detail=excluded.detail, connected_at=excluded.connected_at, last_error=NULL"
  ).run(id, "enabled", account, detail, now());
  recordEvent("curator", "connect", { source: id, detail });
}

export function disconnect(id: SourceId): void {
  db().prepare("DELETE FROM connections WHERE source = ?").run(id);
  recordEvent("curator", "disconnect", { source: id });
}

export function saveOAuth(id: SourceId, t: {
  accessToken: string; refreshToken?: string | null;
  expiresIn?: number | null; scopes?: string | null; account?: string | null;
}): void {
  db().prepare(
    "INSERT INTO connections (source, status, account, access_token, refresh_token, expires_at, scopes, connected_at, last_error)" +
    " VALUES (?,?,?,?,?,?,?,?,NULL)" +
    " ON CONFLICT(source) DO UPDATE SET status=excluded.status, account=excluded.account," +
    " access_token=excluded.access_token, refresh_token=excluded.refresh_token," +
    " expires_at=excluded.expires_at, scopes=excluded.scopes, connected_at=excluded.connected_at, last_error=NULL"
  ).run(
    id, "connected", t.account ?? null, t.accessToken, t.refreshToken ?? null,
    t.expiresIn ? now() + t.expiresIn * 1000 : null,
    t.scopes ?? null, now(),
  );
  recordEvent("curator", "connect", { source: id, account: t.account ?? null });
}

export function noteError(id: SourceId, message: string): void {
  db().prepare(
    "INSERT INTO connections (source, status, connected_at, last_error) VALUES (?,?,?,?)" +
    " ON CONFLICT(source) DO UPDATE SET last_error=excluded.last_error"
  ).run(id, "off", now(), message.slice(0, 300));
}

/** The bearer a connector should send. Null means do not call this source. */
export function tokenFor(id: SourceId): string | null {
  const row = db().prepare(
    "SELECT access_token, expires_at FROM connections WHERE source = ? AND status = 'connected'"
  ).get(id) as { access_token: string | null; expires_at: number | null } | undefined;
  if (!row?.access_token) return null;
  if (row.expires_at && row.expires_at < now()) return null;
  return row.access_token;
}
