import "../library.css";
import { listImages, collectionTree } from "@/lib/queries";
import LibraryView from "@/components/LibraryView";

export const dynamic = "force-dynamic";

function flatten(nodes: ReturnType<typeof collectionTree>, depth = 0): { id: number; name: string; depth: number }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)]);
}

// The browsing surface behind folders, keyterms and search. Not listed in
// the views nav (the Gallery covers casual browsing); reached via filters.
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tag?: string; q?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const filter = {
    collectionId: sp.c ? Number(sp.c) : undefined,
    tag: sp.tag,
    q: sp.q,
    sort: (sp.sort as "newest" | "oldest" | "luma" | "chroma" | "rating") ?? "newest",
    limit: 120,
  };
  const { rows, total } = listImages(filter);
  const collections = flatten(collectionTree());

  return (
    <LibraryView
      initialRows={rows}
      total={total}
      filter={{ c: sp.c ?? "", tag: sp.tag ?? "", q: sp.q ?? "", sort: sp.sort ?? "newest" }}
      collections={collections}
    />
  );
}
