import { analyzeImage, compareImages, VisionError } from "@/lib/vision";
import { rebuildSimilarity } from "@/lib/ingest";

export const maxDuration = 300;

/**
 * POST { imageId }              -> single-image analysis
 * POST { compare: [a, b] }      -> two-image comparative analysis
 * POST { batch: [id, ...] }     -> sequential batch, returns per-id status
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { imageId?: number; compare?: [number, number]; batch?: number[] } | null;
  if (!body) return Response.json({ error: "bad body" }, { status: 400 });

  try {
    if (body.compare?.length === 2) {
      const result = await compareImages(Number(body.compare[0]), Number(body.compare[1]));
      return Response.json({ comparison: result });
    }

    if (Array.isArray(body.batch) && body.batch.length) {
      const ids = body.batch.slice(0, 40).map(Number);
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

    if (body.imageId) {
      const analysis = await analyzeImage(Number(body.imageId));
      return Response.json({ analysis });
    }

    return Response.json({ error: "imageId, compare or batch required" }, { status: 400 });
  } catch (e) {
    const status = e instanceof VisionError ? 502 : 500;
    return Response.json({ error: e instanceof Error ? e.message : "analysis failed" }, { status });
  }
}

/** PUT: rebuild the similarity cache (after bulk edits). */
export async function PUT() {
  const r = rebuildSimilarity();
  return Response.json(r);
}
