import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SAFE_DEMO_GET = [
  /^\/api\/graph$/,
  /^\/api\/list$/,
  /^\/api\/collections$/,
  /^\/api\/images\/\d+$/,
  /^\/api\/img\/\d+$/,
  /^\/api\/compare$/,
  /* Connections, the read-only half. Listing states is a static read on the
     hosted archive (no table, no secret -- lib/connections answers without
     touching the DB there). Outside SEARCH is deliberately public: the open
     museum APIs need no credential, return only links and thumbnails, and
     write nothing -- the same bargain as the hosted agent itself. The thumb
     proxy is fetch-through with a strict host allowlist, so it cannot be
     pointed anywhere but the sources that refuse browsers. What stays
     blocked is everything stateful: POST /api/connections and the whole
     /api/connect OAuth flow, which exist only in the local runtime. */
  /^\/api\/connections$/,
  /^\/api\/sources\/search$/,
  /^\/api\/sources\/thumb$/,
];

/**
 * The POSTs the hosted archive does allow.
 *
 * The agent READS. Its tools search, filter, widen and re-form the field, and
 * every one of them is a SELECT. Staging a folder is a proposal that writes
 * nothing, and /api/agent/apply, the only thing that does write, is
 * deliberately absent from this list. So the archive stays read-only while the
 * thing the project is actually about still works for a visitor.
 *
 * What it does spend is model tokens, on a public URL. The route answers that
 * by running the hosted archive on a small model with a short round budget:
 * see HOSTED_MODEL in app/api/agent/route.ts.
 */
const SAFE_DEMO_POST = [/^\/api\/agent$/];

export function proxy(request: NextRequest) {
  const publicArchive = process.env.ATLAS_ARCHIVE_MODE?.trim() === "public";
  const hostedDemo = !publicArchive
    && (process.env.ATLAS_DEMO?.trim() === "1" || process.env.VERCEL?.trim() === "1");
  if (!publicArchive && !hostedDemo) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const safeGet = (request.method === "GET" || request.method === "HEAD")
    && SAFE_DEMO_GET.some((pattern) => pattern.test(path));
  const safePost = request.method === "POST" && SAFE_DEMO_POST.some((pattern) => pattern.test(path));
  if (safeGet || safePost) return NextResponse.next();

  return NextResponse.json(
    {
      error: "the hosted Agentic Archive is read-only: the agent can look, but nothing here can be written. Run it locally to file, tag or export",
      code: "SHOWCASE_READ_ONLY",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export const config = {
  matcher: "/api/:path*",
};
