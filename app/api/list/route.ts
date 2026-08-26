import { listImages } from "@/lib/queries";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const { rows, total } = listImages({
    collectionId: u.searchParams.get("c") ? Number(u.searchParams.get("c")) : undefined,
    tag: u.searchParams.get("tag") ?? undefined,
    q: u.searchParams.get("q") ?? undefined,
    sort: (u.searchParams.get("sort") as "newest" | "oldest" | "luma" | "chroma" | "rating") ?? "newest",
    flagged: (u.searchParams.get("flag") as "keep" | "reject" | "unsorted") || undefined,
    limit: Math.min(300, Number(u.searchParams.get("limit") ?? 120)),
    offset: Number(u.searchParams.get("offset") ?? 0),
  });
  return Response.json({ rows, total });
}
