import crypto from "node:crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** The scopes Atlas asks for: read your boards and pins, nothing else. */
export const PINTEREST_SCOPES = "boards:read,pins:read,user_accounts:read";

export function callbackUrl(req: Request): string {
  const base = process.env.ATLAS_PUBLIC_URL?.trim().replace(/\/+$/, "")
    || new URL(req.url).origin;
  return base + "/api/connect/pinterest/callback";
}

/**
 * GET /api/connect/pinterest -> send the human to Pinterest to authorise.
 *
 * A one-shot `state` is minted here and parked in an httpOnly cookie so the
 * callback can prove the code came back from the redirect this server started,
 * rather than from a link somebody else constructed.
 */
export async function GET(req: Request) {
  const appId = process.env.ATLAS_PINTEREST_APP_ID?.trim();
  if (!appId || !process.env.ATLAS_PINTEREST_SECRET?.trim()) {
    return Response.json(
      { error: "set ATLAS_PINTEREST_APP_ID and ATLAS_PINTEREST_SECRET in .env.local, then restart" },
      { status: 400 },
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("atlas-pinterest-state", state, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 600,
  });

  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_SCOPES);
  url.searchParams.set("state", state);

  return Response.redirect(url.toString(), 302);
}
