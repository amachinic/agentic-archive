import { db } from "@/lib/db";
import { pHash, palette, hammingHex, histDistance, similarityScore } from "@/lib/imaging";

export const maxDuration = 60;

/**
 * Find library images similar to an UPLOADED image, without ingesting it:
 * fingerprint the upload in memory, score it against every stored
 * fingerprint, return the closest ids (best first).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  if (file.size > 80 * 1024 * 1024) return Response.json({ error: "file too large" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  let ph: string;
  let hist: number[];
  try {
    ph = await pHash(buf);
    hist = (await palette(buf)).histogram;
  } catch {
    return Response.json({ error: "could not read that image" }, { status: 400 });
  }

  const rows = db().prepare(
    "SELECT id, phash, histogram FROM images WHERE phash IS NOT NULL AND histogram IS NOT NULL"
  ).all() as { id: number; phash: string; histogram: string }[];

  const scored = rows
    .map((r) => ({
      id: r.id,
      score: similarityScore(hammingHex(ph, r.phash), histDistance(hist, JSON.parse(r.histogram))),
    }))
    .sort((a, b) => b.score - a.score);

  // strong matches when they exist; otherwise the nearest dozen so the
  // field always has something to form around
  const strong = scored.filter((s) => s.score >= 0.6).slice(0, 60);
  const picks = strong.length >= 8 ? strong : scored.slice(0, 12);
  return Response.json({ ids: picks.map((s) => s.id), top: picks[0]?.score ?? 0 });
}
