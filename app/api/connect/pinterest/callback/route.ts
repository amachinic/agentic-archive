import { cookies } from "next/headers";
import { saveOAuth, noteError } from "@/lib/connections";
import { callbackUrl } from "../route";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
const ME_URL = "https://api.pinterest.com/v5/user_account";

/** Land back on the Connections page carrying a readable outcome. */
function back(req: Request, params: Record<string, string>) {
  const url = new URL("/agents/connections", new URL(req.url).origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
}

/**
 * GET /api/connect/pinterest/callback
 *
 * Pinterest sends the human back here with a code. Exchange it for a token
 * over HTTP Basic (client_id as user, secret as password), then ask who we
 * just authorised as so the page can say WHOSE account is connected rather
 * than the useless "connected".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) return back(req, { connect: "cancelled" });

  const jar = await cookies();
  const expected = jar.get("atlas-pinterest-state")?.value;
  jar.delete("atlas-pinterest-state");

  if (!code) return back(req, { connect: "failed", why: "Pinterest sent no authorisation code" });
  if (!state || !expected || state !== expected) {
    noteError("pinterest", "the authorisation did not match the request this server started");
    return back(req, { connect: "failed", why: "that authorisation did not match this session — try again" });
  }

  const appId = process.env.ATLAS_PINTEREST_APP_ID?.trim() ?? "";
  const secret = process.env.ATLAS_PINTEREST_SECRET?.trim() ?? "";
  if (!appId || !secret) return back(req, { connect: "failed", why: "the Pinterest credentials are no longer set" });

  const basic = Buffer.from(appId + ":" + secret).toString("base64");

  let token: {
    access_token?: string; refresh_token?: string;
    expires_in?: number; scope?: string; message?: string;
  };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl(req),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    token = await res.json().catch(() => ({}));
    if (!res.ok || !token.access_token) {
      const why = token.message || "Pinterest refused the exchange (" + res.status + ")";
      noteError("pinterest", why);
      return back(req, { connect: "failed", why });
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : "the token exchange did not complete";
    noteError("pinterest", why);
    return back(req, { connect: "failed", why });
  }

  /* Who did we just authorise as? Nice to have, never worth failing over. */
  let account: string | null = null;
  try {
    const me = await fetch(ME_URL, {
      headers: { Authorization: "Bearer " + token.access_token },
      signal: AbortSignal.timeout(10_000),
    });
    if (me.ok) {
      const j = await me.json() as { username?: string };
      account = j.username ?? null;
    }
  } catch { /* the connection is still good without a name on it */ }

  saveOAuth("pinterest", {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresIn: token.expires_in ?? null,
    scopes: token.scope ?? null,
    account,
  });

  return back(req, { connect: "pinterest" });
}
