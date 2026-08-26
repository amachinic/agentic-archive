import "../library.css";
import { listImages } from "@/lib/queries";
import WallView from "@/components/WallView";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  // The gallery pulls a generous slice and shuffles client-side per visit.
  const { rows } = listImages({ limit: 400, sort: "newest" });
  const items = rows.map((r) => ({
    id: r.id,
    w: r.width ?? 1,
    h: r.height ?? 1,
    hex: r.dominant_hex ?? "#222",
    title: r.ai_title || r.filename,
  }));
  return <WallView items={items} />;
}
