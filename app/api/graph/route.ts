import { graphData, type SimilarityMode } from "@/lib/queries";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const minScore = Math.max(0.5, Math.min(0.99, Number(u.searchParams.get("min") ?? 0.8)));
  const collectionId = u.searchParams.get("c") ? Number(u.searchParams.get("c")) : undefined;
  const modeRaw = u.searchParams.get("mode");
  const mode: SimilarityMode = modeRaw === "structure" || modeRaw === "color" || modeRaw === "aesthetic" ? modeRaw : "blend";
  return Response.json(graphData(minScore, 6, collectionId, mode));
}
