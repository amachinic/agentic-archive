import "../library.css";
import { listImages } from "@/lib/queries";
import GalleryView, { type GalleryItem } from "@/components/GalleryView";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  // SQLite LIMIT -1 returns the complete archive without imposing a fixed cap.
  const { rows } = listImages({ limit: -1, sort: "newest" });
  const items: GalleryItem[] = rows.map((r) => ({
    id: r.id,
    title: r.ai_title || r.filename,
    artist: r.artist ?? null,
    w: r.width ?? 1,
    h: r.height ?? 1,
    hex: r.dominant_hex ?? "#222",
    format: r.format ?? null,
    bytes: r.bytes ?? null,
    createdAt: r.created_at ?? null,
  }));
  return <GalleryView items={items} />;
}
