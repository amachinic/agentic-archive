import "../library.css";
import { listImages } from "@/lib/queries";
import WallView from "@/components/WallView";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  // SQLite LIMIT -1 returns the complete archive without imposing a fixed cap.
  const { rows } = listImages({ limit: -1, sort: "newest" });
  const items = rows.map((r) => ({
    id: r.id,
    w: r.width ?? 1,
    h: r.height ?? 1,
    hex: r.dominant_hex ?? "#222",
    title: r.ai_title || r.filename,
  }));
  return <WallView items={items} />;
}
