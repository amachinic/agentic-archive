import { db } from "./db";
import { hammingHex, histDistance } from "./imaging";
import type { Swatch } from "./imaging";
import { IS_HOSTED_DEMO, IS_HOSTED_READ_ONLY } from "./runtime";
import {
  demoCollectionTree,
  demoGetImage,
  demoGraphData,
  demoLibraryStats,
  demoListImages,
  demoListTags,
} from "./demo";

/* Read-side queries shared by pages and API routes. */

export type ImageRow = {
  id: number;
  filename: string;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number;
  palette: Swatch[];
  dominant_hex: string | null;
  luma: number | null;
  chroma: number | null;
  phash: string | null;
  prompt_text: string | null;
  ai_title: string | null;
  ai_description: string | null;
  artist: string | null;
  rating: number;
  flagged: number;
  note: string | null;
  created_at: number;
};

type RawImage = Omit<ImageRow, "palette"> & { palette: string | null };

function hydrate(r: RawImage): ImageRow {
  return { ...r, palette: r.palette ? (JSON.parse(r.palette) as Swatch[]) : [] };
}

const IMG_COLS =
  "id, filename, width, height, format, bytes, palette, dominant_hex, luma, chroma, phash, " +
  "prompt_text, ai_title, ai_description, artist, rating, flagged, note, created_at";

export type LibraryFilter = {
  collectionId?: number;
  tag?: string;
  q?: string;
  flagged?: "keep" | "reject" | "unsorted";
  sort?: "newest" | "oldest" | "luma" | "chroma" | "rating";
  limit?: number;
  offset?: number;
};

export function listImages(f: LibraryFilter = {}): { rows: ImageRow[]; total: number } {
  if (IS_HOSTED_DEMO) return demoListImages(f);
  const conn = db();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (f.collectionId) {
    where.push("id IN (SELECT image_id FROM image_collections WHERE collection_id = ?)");
    params.push(f.collectionId);
  }
  if (f.tag) {
    where.push("id IN (SELECT image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)");
    params.push(f.tag);
  }
  if (f.q) {
    /* Search is accent-blind in both directions: typing "hutte" finds Axel
       Hütte, and typing "Hütte" finds a record spelled without the umlaut.
       SQLite has no unaccent(), so the folding is a nest of REPLACEs applied
       to the column and the same folding applied to the term in JS. */
    const FOLD: [string, string][] = [
      ["á", "a"], ["à", "a"], ["â", "a"], ["ä", "a"], ["ã", "a"], ["å", "a"],
      ["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"],
      ["í", "i"], ["ì", "i"], ["î", "i"], ["ï", "i"],
      ["ó", "o"], ["ò", "o"], ["ô", "o"], ["ö", "o"], ["õ", "o"], ["ø", "o"],
      ["ú", "u"], ["ù", "u"], ["û", "u"], ["ü", "u"],
      ["ñ", "n"], ["ç", "c"], ["ß", "s"], ["ć", "c"], ["č", "c"], ["š", "s"], ["ž", "z"], ["ł", "l"],
    ];
    const folded = (col: string) =>
      FOLD.reduce((acc, [from, to]) => "REPLACE(" + acc + ", '" + from + "', '" + to + "')", "LOWER(COALESCE(" + col + ", ''))");
    const cols = ["filename", "ai_title", "ai_description", "prompt_text", "note", "ocr_text", "artist"];
    where.push("(" + cols.map((c) => folded(c) + " LIKE ?").join(" OR ") + ")");
    const term = "%" + FOLD.reduce((acc, [from, to]) => acc.split(from).join(to), f.q.toLowerCase()) + "%";
    for (let i = 0; i < cols.length; i++) params.push(term);
  }
  if (f.flagged === "keep") where.push("flagged = 1");
  if (f.flagged === "reject") where.push("flagged = -1");
  if (f.flagged === "unsorted") where.push("flagged = 0");

  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const order =
    f.sort === "oldest" ? "created_at ASC, id ASC"
    : f.sort === "luma" ? "luma ASC"
    : f.sort === "chroma" ? "chroma DESC"
    : f.sort === "rating" ? "rating DESC, created_at DESC"
    : "created_at DESC, id DESC";

  const total = (conn.prepare("SELECT COUNT(*) AS n FROM images" + whereSql).get(...params) as { n: number }).n;
  const rows = (conn
    .prepare("SELECT " + IMG_COLS + " FROM images" + whereSql + " ORDER BY " + order + " LIMIT ? OFFSET ?")
    .all(...params, f.limit ?? 120, f.offset ?? 0) as RawImage[]).map(hydrate);

  return { rows, total };
}

export function getImage(id: number) {
  if (IS_HOSTED_DEMO) return demoGetImage(id);
  const conn = db();
  const raw = conn.prepare(
    "SELECT " + IMG_COLS + ", source_path, sha256, gen_meta, ai_analysis, ai_model, ai_at FROM images WHERE id = ?"
  ).get(id) as (RawImage & { source_path: string | null; sha256: string; gen_meta: string | null; ai_analysis: string | null; ai_model: string | null; ai_at: number | null }) | undefined;
  if (!raw) return null;

  const tags = conn.prepare(
    "SELECT t.id, t.name, t.kind, it.source FROM tags t JOIN image_tags it ON it.tag_id = t.id WHERE it.image_id = ? ORDER BY t.kind, t.name"
  ).all(id) as { id: number; name: string; kind: string; source: string }[];

  const collections = conn.prepare(
    "SELECT c.id, c.name FROM collections c JOIN image_collections ic ON ic.collection_id = c.id WHERE ic.image_id = ?"
  ).all(id) as { id: number; name: string }[];

  const similar = conn.prepare(
    "SELECT CASE WHEN a_id = ? THEN b_id ELSE a_id END AS other_id, score, phash_d, color_d " +
    "FROM similarity WHERE a_id = ? OR b_id = ? ORDER BY score DESC LIMIT 14"
  ).all(id, id, id) as { other_id: number; score: number; phash_d: number; color_d: number }[];

  const simRows = similar.length
    ? (conn.prepare(
        "SELECT " + IMG_COLS + " FROM images WHERE id IN (" + similar.map(() => "?").join(",") + ")"
      ).all(...similar.map((s) => s.other_id)) as RawImage[]).map(hydrate)
    : [];
  const simMap = new Map(simRows.map((r) => [r.id, r]));

  const links = conn.prepare(
    "SELECT l.id, l.from_id, l.to_id, l.kind, l.note, i.filename, i.ai_title " +
    "FROM links l JOIN images i ON i.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END " +
    "WHERE l.from_id = ? OR l.to_id = ?"
  ).all(id, id, id) as { id: number; from_id: number; to_id: number; kind: string; note: string | null; filename: string; ai_title: string | null }[];

  return {
    ...hydrate(raw),
    source_path: raw.source_path,
    sha256: raw.sha256,
    gen_meta: raw.gen_meta,
    ai_analysis: raw.ai_analysis ? JSON.parse(raw.ai_analysis) : null,
    ai_model: raw.ai_model,
    ai_at: raw.ai_at,
    tags,
    collections,
    similar: similar
      .map((s) => ({ ...s, image: simMap.get(s.other_id) }))
      .filter((s): s is typeof s & { image: ImageRow } => !!s.image),
    links,
  };
}

export type CollectionNode = {
  id: number;
  name: string;
  parent_id: number | null;
  note: string | null;
  count: number;
  children: CollectionNode[];
};

export function collectionTree(): CollectionNode[] {
  if (IS_HOSTED_DEMO) return demoCollectionTree();
  const conn = db();
  const rows = conn.prepare(
    "SELECT c.id, c.name, c.parent_id, c.note, " +
    "(SELECT COUNT(*) FROM image_collections ic WHERE ic.collection_id = c.id) AS count " +
    "FROM collections c ORDER BY c.name COLLATE NOCASE"
  ).all() as (Omit<CollectionNode, "children">)[];

  const byId = new Map<number, CollectionNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: CollectionNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function listTags() {
  if (IS_HOSTED_DEMO) return demoListTags();
  const rows = db().prepare(
    "SELECT t.id, t.name, t.kind, COUNT(it.image_id) AS count FROM tags t " +
    "LEFT JOIN image_tags it ON it.tag_id = t.id GROUP BY t.id HAVING count > 0 ORDER BY count DESC, t.name"
  ).all() as { id: number; name: string; kind: string; count: number }[];
  // node:sqlite rows have a null prototype, which Next refuses to hand from a
  // Server Component to a Client Component. Spread into plain objects.
  return rows.map((r) => ({ ...r }));
}

export function libraryStats() {
  if (IS_HOSTED_DEMO) return demoLibraryStats();
  const conn = db();
  const n = (conn.prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number }).n;
  const analyzed = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE ai_at IS NOT NULL").get() as { n: number }).n;
  const pairs = (conn.prepare("SELECT COUNT(*) AS n FROM similarity").get() as { n: number }).n;
  const tags = (conn.prepare("SELECT COUNT(*) AS n FROM tags").get() as { n: number }).n;
  const keep = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE flagged = 1").get() as { n: number }).n;
  const reject = (conn.prepare("SELECT COUNT(*) AS n FROM images WHERE flagged = -1").get() as { n: number }).n;
  const bytes = (conn.prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM images").get() as { n: number }).n;
  return { images: n, analyzed, pairs, tags, keep, reject, bytes };
}

/**
 * The similarity graph, thresholded for the network view.
 * Node degree is capped per image so one dense cluster of near-identical
 * generations cannot become a hairball that hides everything else.
 */
export type SimilarityMode = "blend" | "structure" | "color" | "aesthetic";

/*
  The tag co-occurrence join is the Network page's whole cost.

  Measured on the deployed archive: the page answered in 3.79s, and
  /api/graph — the same query with no React in the picture — in 3.65s. The
  aesthetic mode runs the identical join TWICE and answered in 7.04s, so one
  execution is ~3.35s of it. Everything else in here totals under 200ms.

  It is expensive because it materialises every pair of images sharing any
  keyterm — 2.8 million intermediate rows on a 926-image archive — and keeps
  the top 1,200. It takes no argument beyond the shared-count floor, so on a
  snapshot that cannot change it is a constant being recomputed for every
  visitor.

  So the hosted archive computes it once per process and keeps it: that DB is
  opened read-only with query_only ON, and nothing in the runtime can write
  to it. The local archive always re-runs, because there the tags genuinely
  change underneath you as you upload and file things.
*/
const tagPairCache = new Map<string, { a_id: number; b_id: number; shared: number }[]>();
type TagPair = { a_id: number; b_id: number; shared: number };
function sharedTagPairs(conn: ReturnType<typeof db>, sharedMin: number, limit: number): TagPair[] {
  const key = sharedMin + ":" + limit;
  if (IS_HOSTED_READ_ONLY) {
    const hit = tagPairCache.get(key);
    if (hit) return hit;
  }
  const rows = conn.prepare(
    "SELECT a.image_id AS a_id, b.image_id AS b_id, COUNT(*) AS shared FROM image_tags a " +
    "JOIN image_tags b ON a.tag_id = b.tag_id AND a.image_id < b.image_id " +
    "GROUP BY a.image_id, b.image_id HAVING shared >= ? ORDER BY shared DESC LIMIT " + Number(limit)
  ).all(sharedMin) as TagPair[];
  if (IS_HOSTED_READ_ONLY) tagPairCache.set(key, rows);
  return rows;
}

/* the field draws cards, not records: it needs a name, a size and a colour.
   Reusing IMG_COLS here read palette, prompt_text, ai_description and note
   off disk for every image and JSON-parsed 926 palettes, all to be thrown
   away by the projection at the end of this function. */
const GRAPH_COLS = "id, filename, width, height, dominant_hex, ai_title, flagged";
type GraphRow = {
  id: number; filename: string; width: number | null; height: number | null;
  dominant_hex: string | null; ai_title: string | null; flagged: number;
};

export function graphData(minScore = 0.8, maxEdgesPerNode = 6, collectionId?: number, mode: SimilarityMode = "blend") {
  if (IS_HOSTED_DEMO) return demoGraphData(minScore, maxEdgesPerNode, collectionId, mode);
  const conn = db();

  const imgFilter = collectionId
    ? " WHERE id IN (SELECT image_id FROM image_collections WHERE collection_id = " + Number(collectionId) + ")"
    : "";
  const nodes = conn.prepare(
    "SELECT " + GRAPH_COLS + " FROM images" + imgFilter
  ).all() as GraphRow[];
  const ids = new Set(nodes.map((n) => n.id));

  /* The similarity wires depend on what "similar" MEANS right now:
       blend     - 72% structure + 28% colour (the cached table)
       structure - composition only: DCT perceptual-hash agreement
       colour    - palette only: histogram agreement
       aesthetic - shared AI keyterms (the slider maps to how many)
     structure/colour are recomputed live from the stored fingerprints so
     neither is limited to pairs that happened to pass the blended floor. */
  const hides = new Set(
    (conn.prepare("SELECT a_id, b_id FROM edge_hides").all() as { a_id: number; b_id: number }[])
      .map((h) => Math.min(h.a_id, h.b_id) + ":" + Math.max(h.a_id, h.b_id))
  );
  const hidden = (a: number, b: number) => hides.has(Math.min(a, b) + ":" + Math.max(a, b));

  const degree = new Map<number, number>();
  const simEdges: { source: number; target: number; score: number; kind: "similarity" }[] = [];
  const pushCapped = (a: number, b: number, score: number) => {
    if (hidden(a, b)) return;
    const da = degree.get(a) ?? 0, dbg = degree.get(b) ?? 0;
    if (da >= maxEdgesPerNode || dbg >= maxEdgesPerNode) return;
    degree.set(a, da + 1);
    degree.set(b, dbg + 1);
    simEdges.push({ source: a, target: b, score, kind: "similarity" });
  };

  if (mode === "blend") {
    const rawEdges = conn.prepare(
      "SELECT a_id, b_id, score FROM similarity WHERE score >= ? ORDER BY score DESC"
    ).all(minScore) as { a_id: number; b_id: number; score: number }[];
    for (const e of rawEdges) {
      if (!ids.has(e.a_id) || !ids.has(e.b_id)) continue;
      pushCapped(e.a_id, e.b_id, e.score);
    }
  } else if (mode === "structure" || mode === "color") {
    const rows = conn.prepare(
      "SELECT id, phash, histogram FROM images WHERE phash IS NOT NULL" +
      (collectionId ? " AND id IN (SELECT image_id FROM image_collections WHERE collection_id = " + Number(collectionId) + ")" : "")
    ).all() as { id: number; phash: string; histogram: string }[];
    const parsed = rows
      .filter((r) => ids.has(r.id))
      .map((r) => ({ id: r.id, phash: r.phash, hist: JSON.parse(r.histogram || "[]") as number[] }));
    const found: { a: number; b: number; score: number }[] = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const score = mode === "structure"
          ? 1 - hammingHex(parsed[i].phash, parsed[j].phash) / 64
          : 1 - histDistance(parsed[i].hist, parsed[j].hist);
        if (score >= minScore) found.push({ a: parsed[i].id, b: parsed[j].id, score });
      }
    }
    found.sort((x, y) => y.score - x.score);
    for (const e of found) pushCapped(e.a, e.b, e.score);
  } else {
    // aesthetic: shared keyterms; the min slider (0.70..0.95) maps to 2..6 shared
    const sharedMin = Math.max(2, Math.min(6, 2 + Math.round((minScore - 0.7) * 16)));
    const pairs = sharedTagPairs(conn, sharedMin, 4000);
    for (const e of pairs) {
      if (!ids.has(e.a_id) || !ids.has(e.b_id)) continue;
      pushCapped(e.a_id, e.b_id, Math.min(1, e.shared / 6));
    }
  }

  // Tag co-occurrence: connect pairs sharing >= 2 tags. Bounded to the most
  // shared pairs so the tag layer stays a layer, not a blanket.
  const tagEdges = sharedTagPairs(conn, 2, 1200)
    .filter((e) => ids.has(e.a_id) && ids.has(e.b_id) && !hidden(e.a_id, e.b_id))
    .map((e) => ({ source: e.a_id, target: e.b_id, score: Math.min(1, e.shared / 6), kind: "tag" as const }));

  const manualEdges = (conn.prepare("SELECT from_id, to_id, kind FROM links").all() as
    { from_id: number; to_id: number; kind: string }[])
    .filter((e) => ids.has(e.from_id) && ids.has(e.to_id))
    .map((e) => ({ source: e.from_id, target: e.to_id, score: 1, kind: "manual" as const, linkKind: e.kind }));

  // Collection membership renders as hulls/groups client-side, not edges.
  const membership = conn.prepare(
    "SELECT image_id, collection_id FROM image_collections"
  ).all() as { image_id: number; collection_id: number }[];

  // per-node keyterms, for client-side field filtering
  const tagRows = conn.prepare(
    "SELECT it.image_id, t.name FROM image_tags it JOIN tags t ON t.id = it.tag_id"
  ).all() as { image_id: number; name: string }[];
  const tagMap = new Map<number, string[]>();
  for (const r of tagRows) {
    (tagMap.get(r.image_id) ?? tagMap.set(r.image_id, []).get(r.image_id)!).push(r.name);
  }

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.ai_title || n.filename,
      hex: n.dominant_hex || "#888888",
      w: n.width, h: n.height,
      flagged: n.flagged,
      analyzed: !!n.ai_title,
      tags: tagMap.get(n.id) ?? [],
    })),
    edges: [...simEdges, ...tagEdges, ...manualEdges],
    membership,
  };
}
