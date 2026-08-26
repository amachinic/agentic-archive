import "../library.css";
import { listImages } from "@/lib/queries";
import AnalyzeView from "@/components/AnalyzeView";

export const dynamic = "force-dynamic";

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const sp = await searchParams;
  const { rows } = listImages({ limit: 60, sort: "newest" });
  const picker = rows.map((r) => ({
    id: r.id,
    title: r.ai_title || r.filename,
    w: r.width ?? 1,
    h: r.height ?? 1,
  }));
  return <AnalyzeView initialPicker={picker} initialId={sp.id ? Number(sp.id) : null} />;
}
