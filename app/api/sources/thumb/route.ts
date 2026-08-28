import { PROXY_HOSTS, AIC_UA } from "@/lib/sources";

export const dynamic = "force-dynamic";

/**
 * GET /api/sources/thumb?url=…
 *
 * Some sources will not serve an image to a browser. The Art Institute's IIIF
 * endpoint refuses any request without an AIC-User-Agent header — measured,
 * not assumed: the same URL is 403 without it and image/jpeg with it — and a
 * browser <img> will never send one. So those thumbnails come through here.
 *
 * The host allowlist is what stops this being an open proxy. Anything not on
 * it is refused outright rather than fetched and forwarded, so this route can
 * never be pointed at an internal address or used to launder traffic.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response("url required", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("not a url", { status: 400 });
  }
  if (target.protocol !== "https:") return new Response("https only", { status: 400 });
  if (!PROXY_HOSTS.has(target.hostname)) {
    return new Response("that host is not proxied", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "AIC-User-Agent": AIC_UA, Accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return new Response("the source did not answer", { status: 504 });
  }
  if (!upstream.ok) return new Response("the source answered " + upstream.status, { status: 502 });

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return new Response("that was not an image", { status: 502 });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      /* the bytes behind a given IIIF URL do not change */
      "Cache-Control": "public, max-age=86400",
    },
  });
}
