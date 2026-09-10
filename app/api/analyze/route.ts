import { analyzeImage, compareImages, httpStatus } from "@/lib/vision";
import { rebuildSimilarity } from "@/lib/ingest";

export const maxDuration = 300;

/** a positive integer id, or nothing: "abc" used to reach the model as NaN */
const idOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * POST { imageId, retitle? }     -> single-image analysis (keeps the title unless retitle)
 * POST { compare: [a, b] }       -> two-image comparative analysis
 * POST { batch: [id, ...] }      -> sequential batch, returns per-id status
 *
 * A fault in the ask (no such image, a compare of one image with itself)
 * answers with its own status; only a model failure answers 502.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { imageId?: unknown; retitle?: unknown; compare?: [unknown, unknown]; batch?: unknown[] } | null;
  if (!body) return Response.json({ error: "bad body" }, { status: 400 });

  try {
    if (Array.isArray(body.compare) && body.compare.length === 2) {
      const a = idOf(body.compare[0]), b = idOf(body.compare[1]);
      if (!a || !b) return Response.json({ error: "compare needs two image ids" }, { status: 400 });
      const result = await compareImages(a, b);
      return Response.json({ comparison: result });
    }

    if (Array.isArray(body.batch) && body.batch.length) {
      const ids = body.batch.slice(0, 40).map(idOf).filter((n): n is number => n !== null);
      const results: { id: number; ok: boolean; error?: string }[] = [];
      // Sequential on purpose: the model rate-limits and 503s under parallel
      // load, and each call already retries with backoff internally.
      for (const id of ids) {
        try {
          await analyzeImage(id);
          results.push({ id, ok: true });
        } catch (e) {
          results.push({ id, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "failed" });
        }
      }
      return Response.json({ results });
    }

    if (body.imageId !== undefined) {
      const id = idOf(body.imageId);
      if (!id) return Response.json({ error: "imageId must be a positive integer" }, { status: 400 });
      const analysis = await analyzeImage(id, { retitle: body.retitle === true });
      return Response.json({ analysis });
    }

    return Response.json({ error: "imageId, compare or batch required" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "analysis failed" }, { status: httpStatus(e) });
  }
}

/** PUT: rebuild the similarity cache (after bulk edits). */
export async function PUT() {
  const r = rebuildSimilarity();
  return Response.json(r);
}
