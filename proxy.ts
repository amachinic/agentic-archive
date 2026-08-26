import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SAFE_DEMO_GET = [
  /^\/api\/graph$/,
  /^\/api\/list$/,
  /^\/api\/collections$/,
  /^\/api\/images\/\d+$/,
  /^\/api\/img\/\d+$/,
  /^\/api\/compare$/,
];

export function proxy(request: NextRequest) {
  const publicArchive = process.env.ATLAS_ARCHIVE_MODE === "public";
  const hostedDemo = !publicArchive
    && (process.env.ATLAS_DEMO === "1" || process.env.VERCEL === "1");
  if (!publicArchive && !hostedDemo) return NextResponse.next();

  const safeGet = (request.method === "GET" || request.method === "HEAD")
    && SAFE_DEMO_GET.some((pattern) => pattern.test(request.nextUrl.pathname));
  if (safeGet) return NextResponse.next();

  return NextResponse.json(
    {
      error: "The hosted Image Archivist archive is read-only. Run the project locally to use archive and agent actions.",
      code: "SHOWCASE_READ_ONLY",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export const config = {
  matcher: "/api/:path*",
};
