import "../library.css";
import { db } from "@/lib/db";
import { getImage } from "@/lib/queries";
import { hammingHex, histDistance, similarityScore } from "@/lib/imaging";
import DiptychView from "@/components/DiptychView";
import { demoDiptychMetrics } from "@/lib/demo";
import { IS_HOSTED_DEMO } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function DiptychPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const aId = Number(sp.a), bId = Number(sp.b);
  const A = Number.isInteger(aId) ? getImage(aId) : null;
  const B = Number.isInteger(bId) ? getImage(bId) : null;

  if (!A || !B) {
    return (
      <>
        <header className="topbar"><h1 className="topbar__title">Diptych</h1></header>
        <div className="work">
          <main className="pane" tabIndex={-1}>
            <div className="empty">
              <h2>Pick two images</h2>
              <p>Open a diptych from the library (shift-click two images), from an image&apos;s similar strip, or by clicking a thread in the network.</p>
            </div>
          </main>
        </div>
      </>
    );
  }

  // Local metrics computed here, not shipped to the model: structure, colour,
  // and the combined score, present even for pairs below the similarity floor.
  const metrics = IS_HOSTED_DEMO
    ? demoDiptychMetrics(aId, bId)
    : (() => {
        const rows = db().prepare("SELECT id, histogram FROM images WHERE id IN (?,?)").all(aId, bId) as
          { id: number; histogram: string | null }[];
        const hist = new Map(rows.map((r) => [r.id, JSON.parse(r.histogram || "[]") as number[]]));
        const phashD = A.phash && B.phash ? hammingHex(A.phash, B.phash) : 64;
        const colorD = histDistance(hist.get(aId) ?? [], hist.get(bId) ?? []);
        return { phashD, colorD, score: similarityScore(phashD, colorD) };
      })();

  const lite = (x: NonNullable<ReturnType<typeof getImage>>) => ({
    id: x.id,
    filename: x.filename,
    title: x.ai_title || x.filename,
    width: x.width, height: x.height, bytes: x.bytes, format: x.format,
    palette: x.palette,
    luma: x.luma, chroma: x.chroma,
    flagged: x.flagged,
  });

  return <DiptychView a={lite(A)} b={lite(B)} metrics={metrics} />;
}
