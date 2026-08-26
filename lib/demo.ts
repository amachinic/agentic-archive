import type { Analysis, Comparison } from "./vision";
import type {
  CollectionNode,
  ImageRow,
  LibraryFilter,
  SimilarityMode,
} from "./queries";

type DemoSeed = {
  id: number;
  title: string;
  description: string;
  subjects: string[];
  style: string[];
  mood: string[];
  medium: string;
  palette: string[];
  luma: number;
  chroma: number;
  material: string;
  lighting: string;
  aesthetic: string;
  technique: string;
  period: string;
  composition: string;
  color: string;
  critique: string;
  differentiation: string;
};

const SEEDS: DemoSeed[] = [
  {
    id: 1,
    title: "Concrete threshold",
    description: "A raw concrete stair climbs into a narrow doorway while a hard diagonal of daylight divides the frame. The architecture reads as both circulation and graphic shape.",
    subjects: ["architecture", "geometry", "shadow"],
    style: ["brutalist", "minimalist", "high contrast"],
    mood: ["austere", "solemn"],
    medium: "photography",
    palette: ["#171717", "#565656", "#d7d5cf", "#f2f0ea"],
    luma: 0.39,
    chroma: 0.04,
    material: "Board-marked concrete and matte shadow give the frame a dry, architectural weight.",
    lighting: "One hard source cuts from upper right, producing a long geometric shadow with almost no fill.",
    aesthetic: "The image sits between brutalist documentation and reductive editorial still life.",
    technique: "A fixed architectural viewpoint compresses the stair, wall, and doorway into graphic planes.",
    period: "late-modernist architectural photography",
    composition: "The stair rises against the light diagonal and resolves at the dark doorway near the upper third.",
    color: "A nearly monochrome concrete range lets value contrast carry the entire image.",
    critique: "The geometry is decisive and immediately legible; the clipped lower stair makes the entry feel slightly abrupt.",
    differentiation: "Shift the viewpoint lower so the stair becomes a more forceful wedge against the illuminated wall.",
  },
  {
    id: 2,
    title: "Transparent measures",
    description: "Clear acrylic prisms, cylinders, and an arch stand on a pale studio surface. Refraction and faint spectral edges reveal forms that would otherwise disappear.",
    subjects: ["object", "geometry", "light"],
    style: ["minimalist", "futuristic", "geometric"],
    mood: ["clinical", "ethereal"],
    medium: "photography",
    palette: ["#f1f1ef", "#cfd2d4", "#aab2bb", "#ffffff"],
    luma: 0.82,
    chroma: 0.08,
    material: "Polished acrylic and chrome bend the neutral studio into fine spectral edges.",
    lighting: "Broad side light creates long soft shadows while thin highlights describe each transparent edge.",
    aesthetic: "It borrows from precision product photography and post-digital material studies.",
    technique: "Controlled backlighting and careful object spacing make transparent volumes readable.",
    period: "contemporary product editorial",
    composition: "Vertical prisms establish rhythm while the arch and low cylinder settle the lower right.",
    color: "Cool whites and silvers are interrupted by restrained prismatic color.",
    critique: "The material hierarchy is clear, though the repeated upright forms could use one stronger scale break.",
    differentiation: "Introduce a single smoked acrylic volume to create depth without losing the quiet palette.",
  },
  {
    id: 3,
    title: "Red geometry",
    description: "Red circles, bars, and wedges lock into a black modular field. The composition behaves like a poster without relying on words.",
    subjects: ["abstract", "geometry", "poster text"],
    style: ["geometric", "modernist", "high contrast", "graphic design"],
    mood: ["intense", "energetic"],
    medium: "graphic design",
    palette: ["#080808", "#d51d22", "#8e0d12", "#f4f1eb"],
    luma: 0.22,
    chroma: 0.78,
    material: "Flat fields of ink-like red and black read as a dense printed surface.",
    lighting: "The image is self-lit and planar, with contrast created entirely by shape and color.",
    aesthetic: "Constructivist poster logic is reduced into a contemporary modular system.",
    technique: "Crisp vector geometry is aligned to a strict underlying grid.",
    period: "1920s constructivism reframed now",
    composition: "Large circular arcs counter a tight lower grid, producing tension between sweep and module.",
    color: "Saturated red advances sharply against a deep black field.",
    critique: "The silhouette is memorable and the pacing is strong; the lower modules compete slightly for attention.",
    differentiation: "Remove one lower module and let the resulting black interval become an active pause.",
  },
  {
    id: 4,
    title: "Folded monochrome",
    description: "White, grey, and black paper planes stand and fold across a seamless studio. Negative space turns the small construction into an architectural study.",
    subjects: ["abstract", "geometry", "negative space"],
    style: ["monochrome", "minimalist", "geometric"],
    mood: ["calm", "austere"],
    medium: "photography",
    palette: ["#f3f3f1", "#bdbdbb", "#494949", "#111111"],
    luma: 0.66,
    chroma: 0.02,
    material: "Heavy paper stock holds sharp creases, matte faces, and clean cut edges.",
    lighting: "A large soft source from the left creates controlled tonal steps rather than dramatic shadows.",
    aesthetic: "The arrangement recalls Bauhaus material exercises and monochrome set design.",
    technique: "Hand-folded paper forms are staged as a compact tabletop construction.",
    period: "modernist studio study",
    composition: "Three upright forms bracket a dark central fold and preserve generous air around the structure.",
    color: "A full monochrome value scale separates overlapping planes with no chromatic distraction.",
    critique: "The balance is exact and quiet; the central black fold risks reading as a void rather than material.",
    differentiation: "Rotate the central fold enough to catch a narrow highlight and clarify its surface.",
  },
  {
    id: 5,
    title: "Electric water",
    description: "Cobalt pool water is broken into bright cellular reflections. A dark band enters from the left and gives the luminous pattern a strong edge.",
    subjects: ["water", "pattern", "light"],
    style: ["colorful", "organic", "high contrast"],
    mood: ["energetic", "dreamlike"],
    medium: "photography",
    palette: ["#041332", "#0755a3", "#0ca6ed", "#8de5ff"],
    luma: 0.38,
    chroma: 0.86,
    material: "Rippling water turns sunlight into a shifting network of bright caustics.",
    lighting: "Direct sun refracts through the surface and concentrates into electric lines below.",
    aesthetic: "The crop moves documentary pool photography toward pure optical abstraction.",
    technique: "A tight overhead crop freezes a transient reflection pattern at high contrast.",
    period: "contemporary color photography",
    composition: "The dark left block anchors an otherwise continuous field of moving cells.",
    color: "Deep cobalt carries the image while cyan highlights create a luminous upper register.",
    critique: "The pattern has strong energy; the dark edge could feel accidental without a more deliberate angle.",
    differentiation: "Use a slower shutter so a portion of the caustic grid stretches into fluid bands.",
  },
  {
    id: 6,
    title: "Cantilever study",
    description: "A chrome and black tubular chair sits alone against a white seamless. Its frame projects crisp shadows that repeat the object as line drawing.",
    subjects: ["furniture", "object", "shadow"],
    style: ["modernist", "minimalist", "editorial"],
    mood: ["clinical", "calm"],
    medium: "photography",
    palette: ["#f4f4f2", "#c8c8c6", "#5f6060", "#161616"],
    luma: 0.73,
    chroma: 0.03,
    material: "Polished tubular steel and taut black upholstery contrast reflective line with matte plane.",
    lighting: "Hard studio light from upper left creates crisp repeated rails on the floor.",
    aesthetic: "A museum-catalogue object portrait emphasizes modernist construction over lifestyle context.",
    technique: "Three-quarter product framing keeps the tubular system legible from arm to base.",
    period: "1920s modernism through contemporary editorial",
    composition: "The chair occupies the lower center with open white space preserving the clarity of its outline.",
    color: "Neutral white, chrome, and black reduce the object to structure and reflection.",
    critique: "The frame reads cleanly, though the centered placement is more archival than provocative.",
    differentiation: "Crop closer from a lower angle so the front tube becomes an assertive foreground line.",
  },
  {
    id: 7,
    title: "Botanical structure",
    description: "A broad green leaf fills the frame with radiating veins and small water beads. The crop converts organic growth into an architectural fan.",
    subjects: ["plant", "texture", "pattern"],
    style: ["organic", "colorful", "high contrast"],
    mood: ["serene", "intense"],
    medium: "photography",
    palette: ["#102214", "#2d552b", "#6c8d43", "#b3c875"],
    luma: 0.34,
    chroma: 0.55,
    material: "A waxy leaf surface holds fine ribs, pooled moisture, and soft reflective ridges.",
    lighting: "Raking side light pulls highlights along the veins and lets the folds fall into deep green.",
    aesthetic: "Botanical macro photography is treated with the monumentality of landscape.",
    technique: "Close focus and edge-to-edge cropping suppress scale and emphasize structure.",
    period: "contemporary nature editorial",
    composition: "Veins radiate from the lower center and guide the eye outward in a controlled fan.",
    color: "Layered olive and emerald greens create depth without leaving a single hue family.",
    critique: "The radial structure is compelling; the darkest upper corner closes the frame a little heavily.",
    differentiation: "Introduce a shallow focal plane so one vein remains exact while adjacent planes soften.",
  },
  {
    id: 8,
    title: "Orange fold",
    description: "Saturated orange fabric twists into broad valleys and a tight central knot. Directional light turns the textile into a warm topography.",
    subjects: ["texture", "abstract", "fashion"],
    style: ["colorful", "organic", "editorial"],
    mood: ["energetic", "playful"],
    medium: "photography",
    palette: ["#6f1e05", "#c7470b", "#ee6e16", "#ff9b3d"],
    luma: 0.46,
    chroma: 0.88,
    material: "Dense woven cloth holds rounded folds with a lightly brushed surface.",
    lighting: "Low directional light skims the textile and creates deep warm valleys.",
    aesthetic: "Fashion detail photography is pushed toward tactile color-field abstraction.",
    technique: "A close crop and deliberate fabric styling build depth from repeated folds.",
    period: "contemporary material editorial",
    composition: "Diagonal folds converge at a compressed center before opening toward the corners.",
    color: "A narrow orange spectrum moves from burnt shadow to vivid tangerine highlight.",
    critique: "The color and texture are immediate; the central knot is visually dense compared with the broad outer planes.",
    differentiation: "Let one fold break the frame edge as a clean diagonal to add a stronger graphic counterpoint.",
  },
  {
    id: 9,
    title: "Night facade",
    description: "A dark glass office facade extends as a strict window grid. Scattered illuminated rooms interrupt the repetition and suggest unseen activity.",
    subjects: ["architecture", "grid", "light"],
    style: ["dark", "geometric", "cinematic"],
    mood: ["mysterious", "solitary"],
    medium: "photography",
    palette: ["#080b0f", "#16202b", "#6f6755", "#d4c7a0"],
    luma: 0.16,
    chroma: 0.16,
    material: "Reflective curtain wall glass and dark mullions form a deep, repetitive surface.",
    lighting: "Small pockets of warm interior light puncture an otherwise underexposed facade.",
    aesthetic: "Urban documentary photography meets the suspense of a restrained film still.",
    technique: "A compressed oblique view flattens a large building into a receding grid.",
    period: "late-20th-century corporate modernism",
    composition: "The diagonal perspective pulls the window matrix toward the upper right while lit rooms create syncopation.",
    color: "Cool near-black glass is interrupted by a handful of muted amber squares.",
    critique: "The sparse light pattern gives the grid narrative tension; the lowest corner loses some surface detail.",
    differentiation: "Wait for one stronger illuminated room near an edge to create a more decisive off-center anchor.",
  },
  {
    id: 10,
    title: "Balanced stone",
    description: "Three rough stone forms balance into a compact vertical sculpture on a neutral seamless. Uneven surfaces soften the precision of the stack.",
    subjects: ["sculpture", "object", "geometry"],
    style: ["minimalist", "organic", "editorial"],
    mood: ["calm", "contemplative"],
    medium: "photography",
    palette: ["#302c28", "#777069", "#b2aaa0", "#dedbd6"],
    luma: 0.48,
    chroma: 0.08,
    material: "Coarse stone faces, chipped edges, and pale mineral grain make each mass distinct.",
    lighting: "A focused soft source models the front planes and releases a quiet shadow to the right.",
    aesthetic: "A sculptural still life joins primitive material with controlled studio restraint.",
    technique: "Careful physical balancing and a straight-on crop emphasize weight and contact points.",
    period: "contemporary sculptural still life",
    composition: "A tall irregular stone crowns two lower supports, creating a compact triangular silhouette.",
    color: "Warm mineral neutrals separate through value and texture rather than saturation.",
    critique: "The precarious balance carries the image; the background value is close to the upper stone and slightly reduces its edge.",
    differentiation: "Move the light laterally to cut a brighter rim around the upper mass without making the scene theatrical.",
  },
  {
    id: 11,
    title: "Fog line",
    description: "A low wooded ridge sits between pale water and an almost white sky. Fog erases detail until the landscape becomes three quiet horizontal bands.",
    subjects: ["landscape", "water", "sky", "negative space"],
    style: ["low contrast", "minimalist", "documentary"],
    mood: ["contemplative", "serene", "solitary"],
    medium: "photography",
    palette: ["#687276", "#949da0", "#c7ccce", "#eff0ef"],
    luma: 0.7,
    chroma: 0.05,
    material: "Mist, still water, and a softened tree line compress into layered atmospheric planes.",
    lighting: "Diffuse overcast light removes cast shadows and lowers contrast across the scene.",
    aesthetic: "The landscape is treated with the restraint of minimalist ink wash.",
    technique: "A long horizontal framing and gentle exposure preserve subtle tonal separation in fog.",
    period: "contemporary contemplative landscape",
    composition: "The ridge holds just below center, leaving most of the frame to open sky and reflection.",
    color: "Cool grey-green tones differ by only a few values, making atmosphere the primary color event.",
    critique: "The restraint is convincing; the nearly centered ridge could feel static at larger display sizes.",
    differentiation: "Lower the horizon to give the fog a more expansive role and make the ridge feel less illustrative.",
  },
  {
    id: 12,
    title: "Light trace",
    description: "A narrow warm beam crosses a dark grainy surface and fades into black. The image holds just enough texture to suggest material without naming a place.",
    subjects: ["abstract", "light", "shadow", "texture"],
    style: ["dark", "cinematic", "grainy"],
    mood: ["mysterious", "eerie"],
    medium: "photography",
    palette: ["#080705", "#33291d", "#806846", "#c8a674"],
    luma: 0.2,
    chroma: 0.18,
    material: "A fine tactile surface catches the beam while the surrounding material falls away into black.",
    lighting: "One narrow hard source grazes diagonally across the surface with no ambient fill.",
    aesthetic: "The frame reads like an abstract insert from a restrained nocturnal film.",
    technique: "Underexposure and visible grain preserve ambiguity while the light path supplies structure.",
    period: "contemporary cinematic abstraction",
    composition: "The beam enters low left, widens near center, and exits before the upper right corner.",
    color: "Warm ochre light is held inside a nearly black field.",
    critique: "The ambiguity is useful and the diagonal is clear; the center could retain slightly more surface information.",
    differentiation: "Add one small interruption in the beam so the material reads through shadow rather than exposure alone.",
  },
];

const COLLECTION_MEMBERS: Record<number, number[]> = {
  1: SEEDS.map((s) => s.id),
  2: [1, 2, 4, 6, 10],
  3: [3, 5, 7, 8, 9, 11, 12],
};

const EDGES = [
  { source: 1, target: 9, score: 0.91, kind: "similarity" as const },
  { source: 1, target: 10, score: 0.83, kind: "tag" as const },
  { source: 2, target: 4, score: 0.89, kind: "similarity" as const },
  { source: 2, target: 6, score: 0.86, kind: "tag" as const },
  { source: 3, target: 4, score: 0.84, kind: "tag" as const },
  { source: 3, target: 8, score: 0.81, kind: "similarity" as const },
  { source: 4, target: 11, score: 0.82, kind: "similarity" as const },
  { source: 5, target: 7, score: 0.88, kind: "tag" as const },
  { source: 5, target: 12, score: 0.85, kind: "similarity" as const },
  { source: 7, target: 8, score: 0.82, kind: "tag" as const },
  { source: 9, target: 12, score: 0.9, kind: "similarity" as const },
  { source: 10, target: 11, score: 0.86, kind: "similarity" as const },
];

function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function palette(colors: string[]) {
  const weights = [0.42, 0.28, 0.19, 0.11];
  return colors.map((hex, i) => ({ hex, ...rgb(hex), pct: weights[i] ?? 0.1 }));
}

function analysis(seed: DemoSeed): Analysis {
  return {
    title: seed.title,
    description: seed.description,
    subjects: seed.subjects,
    style: seed.style,
    mood: seed.mood,
    medium: seed.medium,
    material: seed.material,
    lighting: seed.lighting,
    aesthetic: seed.aesthetic,
    technique: seed.technique,
    historical_context: "This reference is part of the synthetic public demo set and is discussed by visual lineage rather than attributed as an existing artwork.",
    artist_reference: "It recalls disciplined editorial and art-direction studies without claiming a specific creator.",
    time_period: seed.period,
    composition: seed.composition,
    color_reading: seed.color,
    critique: seed.critique,
    differentiation: seed.differentiation,
  };
}

export const DEMO_ROWS: ImageRow[] = SEEDS.map((seed) => ({
  id: seed.id,
  filename: "demo-reference-" + String(seed.id).padStart(2, "0") + ".webp",
  width: 362,
  height: 362,
  format: "webp",
  bytes: 18_000 + seed.id * 1_137,
  palette: palette(seed.palette),
  dominant_hex: seed.palette[0],
  luma: seed.luma,
  chroma: seed.chroma,
  phash: null,
  prompt_text: null,
  ai_title: seed.title,
  ai_description: seed.description,
  artist: null,
  rating: seed.id % 4 === 0 ? 5 : seed.id % 3 === 0 ? 4 : 0,
  flagged: [1, 3, 5, 9].includes(seed.id) ? 1 : 0,
  note: null,
  created_at: Date.UTC(2026, 7, seed.id),
}));

export function demoAssetPath(id: number) {
  return SEEDS.some((s) => s.id === id)
    ? "/demo/reference-" + String(id).padStart(2, "0") + ".webp"
    : null;
}

function tagsFor(seed: DemoSeed) {
  return [
    ...seed.subjects.map((name) => ({ name, kind: "subject" })),
    ...seed.style.map((name) => ({ name, kind: "style" })),
    ...seed.mood.map((name) => ({ name, kind: "mood" })),
    { name: seed.medium, kind: "medium" },
    { name: "square", kind: "format" },
  ];
}

function seedFor(id: number) {
  return SEEDS.find((seed) => seed.id === id);
}

export function demoListImages(f: LibraryFilter = {}) {
  let rows = [...DEMO_ROWS];
  if (f.collectionId) {
    const ids = new Set(COLLECTION_MEMBERS[f.collectionId] ?? []);
    rows = rows.filter((row) => ids.has(row.id));
  }
  if (f.tag) {
    rows = rows.filter((row) => {
      const seed = seedFor(row.id);
      return seed ? tagsFor(seed).some((tag) => tag.name === f.tag) : false;
    });
  }
  if (f.q) {
    const q = f.q.trim().toLocaleLowerCase();
    rows = rows.filter((row) => {
      const seed = seedFor(row.id);
      const haystack = [
        row.filename,
        row.ai_title,
        row.ai_description,
        ...(seed ? tagsFor(seed).map((tag) => tag.name) : []),
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(q);
    });
  }
  if (f.flagged === "keep") rows = rows.filter((row) => row.flagged === 1);
  if (f.flagged === "reject") rows = rows.filter((row) => row.flagged === -1);
  if (f.flagged === "unsorted") rows = rows.filter((row) => row.flagged === 0);

  rows.sort((a, b) => {
    if (f.sort === "oldest") return a.created_at - b.created_at;
    if (f.sort === "luma") return (a.luma ?? 0) - (b.luma ?? 0);
    if (f.sort === "chroma") return (b.chroma ?? 0) - (a.chroma ?? 0);
    if (f.sort === "rating") return b.rating - a.rating || b.created_at - a.created_at;
    return b.created_at - a.created_at;
  });

  const total = rows.length;
  const offset = Math.max(0, f.offset ?? 0);
  return { rows: rows.slice(offset, offset + Math.max(0, f.limit ?? 120)), total };
}

export function demoCollectionTree(): CollectionNode[] {
  return [
    {
      id: 1,
      name: "Demo archive",
      parent_id: null,
      note: "Synthetic references for the public read-only showcase.",
      count: COLLECTION_MEMBERS[1].length,
      children: [
        { id: 2, name: "Material & form", parent_id: 1, note: null, count: COLLECTION_MEMBERS[2].length, children: [] },
        { id: 3, name: "Color & atmosphere", parent_id: 1, note: null, count: COLLECTION_MEMBERS[3].length, children: [] },
      ],
    },
  ];
}

export function demoListTags() {
  const counts = new Map<string, { name: string; kind: string; count: number }>();
  for (const seed of SEEDS) {
    for (const tag of tagsFor(seed)) {
      const key = tag.kind + ":" + tag.name;
      const current = counts.get(key);
      if (current) current.count++;
      else counts.set(key, { ...tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((tag, index) => ({ id: index + 1, ...tag }));
}

export function demoLibraryStats() {
  return {
    images: DEMO_ROWS.length,
    analyzed: DEMO_ROWS.length,
    pairs: EDGES.length,
    tags: demoListTags().length,
    keep: DEMO_ROWS.filter((row) => row.flagged === 1).length,
    reject: 0,
    bytes: DEMO_ROWS.reduce((total, row) => total + row.bytes, 0),
  };
}

export function demoGraphData(
  minScore = 0.8,
  _maxEdgesPerNode = 6,
  collectionId?: number,
  mode: SimilarityMode = "blend",
) {
  const rows = collectionId
    ? DEMO_ROWS.filter((row) => (COLLECTION_MEMBERS[collectionId] ?? []).includes(row.id))
    : DEMO_ROWS;
  const ids = new Set(rows.map((row) => row.id));
  const modeEdges = EDGES.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.score < minScore) return false;
    if (mode === "structure") return [1, 2, 3, 4, 6, 9, 10].includes(edge.source) || [1, 2, 3, 4, 6, 9, 10].includes(edge.target);
    if (mode === "color") return [3, 5, 7, 8, 9, 12].includes(edge.source) && [3, 5, 7, 8, 9, 12].includes(edge.target);
    if (mode === "aesthetic") return edge.kind === "tag";
    return true;
  });
  return {
    nodes: rows.map((row) => ({
      id: row.id,
      label: row.ai_title || row.filename,
      hex: row.dominant_hex || "#888888",
      w: row.width,
      h: row.height,
      flagged: row.flagged,
      analyzed: true,
      tags: seedFor(row.id) ? tagsFor(seedFor(row.id)!).map((tag) => tag.name) : [],
    })),
    edges: modeEdges,
    membership: Object.entries(COLLECTION_MEMBERS).flatMap(([collectionId, imageIds]) =>
      imageIds.filter((imageId) => ids.has(imageId)).map((imageId) => ({ image_id: imageId, collection_id: Number(collectionId) })),
    ),
  };
}

export function demoGetImage(id: number) {
  const row = DEMO_ROWS.find((candidate) => candidate.id === id);
  const seed = seedFor(id);
  if (!row || !seed) return null;
  const tagIndex = new Map(demoListTags().map((tag) => [tag.kind + ":" + tag.name, tag.id]));
  const memberships = Object.entries(COLLECTION_MEMBERS)
    .filter(([, imageIds]) => imageIds.includes(id))
    .map(([collectionId]) => {
      const node = [demoCollectionTree()[0], ...demoCollectionTree()[0].children].find((item) => item.id === Number(collectionId));
      return { id: Number(collectionId), name: node?.name ?? "Demo archive" };
    });
  const similar = EDGES
    .filter((edge) => edge.source === id || edge.target === id)
    .sort((a, b) => b.score - a.score)
    .map((edge) => {
      const otherId = edge.source === id ? edge.target : edge.source;
      return { other_id: otherId, score: edge.score, image: DEMO_ROWS.find((candidate) => candidate.id === otherId)! };
    });
  return {
    ...row,
    source_path: null,
    sha256: "public-demo-" + String(id).padStart(2, "0"),
    gen_meta: null,
    ai_analysis: analysis(seed),
    ai_model: "curated demo brief",
    ai_at: Date.UTC(2026, 7, 20),
    tags: tagsFor(seed).map((tag) => ({
      id: tagIndex.get(tag.kind + ":" + tag.name) ?? id * 100,
      ...tag,
      source: "ai",
    })),
    collections: memberships,
    similar,
    links: [],
  };
}

export function demoDiptychMetrics(aId: number, bId: number) {
  const a = DEMO_ROWS.find((row) => row.id === aId);
  const b = DEMO_ROWS.find((row) => row.id === bId);
  const known = EDGES.find((edge) =>
    (edge.source === aId && edge.target === bId) || (edge.source === bId && edge.target === aId));
  const score = known?.score ?? 0.64;
  return {
    phashD: Math.round((1 - score) * 64),
    colorD: a && b ? Math.min(1, Math.abs((a.chroma ?? 0) - (b.chroma ?? 0))) : 0.5,
    score,
  };
}

export function demoComparison(aId: number, bId: number): Comparison | null {
  const a = seedFor(aId);
  const b = seedFor(bId);
  if (!a || !b) return null;
  const aTags = new Set(tagsFor(a).map((tag) => tag.name));
  const shared = tagsFor(b).map((tag) => tag.name).filter((tag) => aTags.has(tag)).slice(0, 4);
  return {
    verdict: shared.length
      ? "The pair shares " + shared.join(", ") + " while using those qualities for distinct visual jobs."
      : "The pair is more useful as a contrast than as a close visual family.",
    shared: shared.length ? shared : ["controlled framing", "clear material hierarchy"],
    differences: [a.title + " is driven by " + a.composition.toLowerCase(), b.title + " is driven by " + b.composition.toLowerCase()],
    stronger: "neither",
    why: "Each image resolves its own hierarchy cleanly; the useful decision is which visual register belongs in the intended set.",
    how_to_diverge: "Push one reference further toward its dominant material or color behavior instead of borrowing the other image's strongest cue.",
  };
}
