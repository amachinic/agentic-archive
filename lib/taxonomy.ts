/*
  The controlled vocabulary.

  Two rules make keyterms behave like categories instead of captions:

  1. ONE NAME, ONE KIND. The tags table keys on name alone, so a term can
     only ever mean one thing. Before this file existed, the fingerprint pass
     wrote "portrait" as an ASPECT RATIO while the vision model wrote it as a
     SUBJECT, and whichever ran last flipped the shared row's kind — 354 merely
     tall images ended up filed as portraiture. Aspect terms are now named for
     the shape (tall / wide / square / panoramic), leaving portrait and
     landscape free to mean what they depict.

  2. TAGGERS PICK, THEY DO NOT INVENT. Every keyterm comes from the lists
     below. A model that may write free text produces "pocket square",
     "white hair", "slightly unsettling" — each true of exactly one image and
     therefore useless as a filter. Detail belongs in the description, which
     search reads; the keyterm is the category it files under.
*/

export const TAXONOMY: Record<string, string[]> = {
  /* what the image depicts */
  subject: [
    "portrait", "figure", "crowd", "body", "hand", "face", "fashion",
    "architecture", "interior", "cityscape", "landscape", "nature", "sky", "water", "plant",
    "object", "furniture", "vehicle", "animal", "food", "still life",
    "text", "typography", "quote", "poem", "journal", "essay", "philosophy", "letter",
    "document", "label", "poster text", "handwriting", "book", "page", "subtitles",
    "diagram", "map", "symbol", "logo", "signage",
    "abstract", "pattern", "texture", "geometry", "grid", "light", "shadow",
    "silhouette", "negative space",
    "screen", "film still", "album cover", "sculpture", "artwork",
  ],
  /* the visual language */
  style: [
    "monochrome", "colorful", "dark", "bright", "high contrast", "low contrast",
    "minimalist", "maximalist", "grainy", "halftone", "editorial", "brutalist",
    "swiss", "modernist", "psychedelic", "surreal", "documentary", "cinematic",
    "illustrative", "geometric", "organic", "retro", "futuristic", "lo-fi",
    "glitch", "archival", "typographic", "painterly", "expressionist", "conceptual",
  ],
  /* the emotional register */
  mood: [
    "calm", "serene", "intense", "melancholic", "playful", "austere", "dreamlike",
    "eerie", "nostalgic", "romantic", "clinical", "chaotic", "mysterious",
    "energetic", "contemplative", "solemn", "solitary", "ethereal", "raw",
  ],
  /* how it was made */
  medium: [
    "photography", "illustration", "graphic design", "3d render", "painting",
    "collage", "mixed media", "screenshot", "print",
  ],
  /* the shape of the frame: written from dimensions, never from a model */
  format: ["tall", "wide", "square", "panoramic"],
};

/** name -> its one canonical kind */
export const KIND_OF: Record<string, string> = Object.fromEntries(
  Object.entries(TAXONOMY).flatMap(([kind, names]) => names.map((n) => [n, kind])),
);

/**
 * Variants of a canonical term: plurals, spellings, near-synonyms, and the
 * over-specific phrases that should collapse into the category they belong to.
 * An empty string means DROP: it describes one image, not a category.
 */
export const ALIASES: Record<string, string> = {
  /* aspect ratio, renamed away from the subject words it was colliding with */
  "portrait-format": "tall",
  "landscape-format": "wide",

  /* spelling and hyphen variants */
  "high-contrast": "high contrast",
  "monochromatic": "monochrome",
  "melancholy": "melancholic",
  "moody": "melancholic",
  "somber": "solemn",
  "meditative": "contemplative",
  "conceptual art": "conceptual",
  "graphic": "graphic design",
  "photographic": "photography",
  "film photography": "photography",
  "street photography": "documentary",
  "architectural photography": "architecture",
  "grid-based": "grid",
  "grid layout": "grid",
  "layout": "grid",
  "mixed": "mixed media",
  "lithograph": "print",
  "sketch": "illustration",
  "sketchy": "illustrative",
  "gestural": "expressionist",
  "abstract lines": "abstract",
  "lines": "abstract",
  "neon lines": "abstract",
  "geometric shapes": "geometry",
  "film grain": "grainy",
  "grain": "grainy",
  "analog": "archival",
  "classic": "retro",
  "classical": "retro",
  "vintage": "retro",

  /* plurals and singulars of the same thing */
  "portraits": "portrait",
  "hands": "hand",
  "chairs": "furniture",
  "chair": "furniture",
  "trees": "plant",
  "tree": "plant",
  "leaves": "plant",
  "grass": "plant",
  "roots": "plant",
  "tree branch": "plant",
  "clouds": "sky",
  "stars": "sky",
  "galaxy": "sky",
  "cosmic": "sky",
  "people": "crowd",
  "men": "crowd",
  "person": "figure",
  "man": "figure",
  "model": "figure",
  "young woman": "figure",
  "human figure": "figure",
  "human body": "body",
  "limbs": "body",
  "leg": "body",
  "skin": "body",
  "head": "face",
  "eye": "face",
  "beard": "face",
  "white hair": "face",
  "silhouettes": "silhouette",
  "doors": "architecture",
  "door": "architecture",
  "windows": "architecture",
  "building": "architecture",
  "wall": "architecture",
  "concrete wall": "architecture",
  "tiled walls": "architecture",
  "handrail": "architecture",
  "subway stairs": "architecture",
  "bench": "furniture",
  "suits": "fashion",
  "suit": "fashion",
  "sweaters": "fashion",
  "blazer": "fashion",
  "black jacket": "fashion",
  "school uniform": "fashion",
  "sneakers": "fashion",
  "glasses": "fashion",
  "tie": "fashion",
  "pocket square": "fashion",
  "pages": "page",
  "paper": "page",
  "cardboard": "page",
  "spine": "book",
  "bookshelf": "book",
  "envelope": "letter",
  "postmark": "letter",
  "stamp": "letter",
  "mailbox": "letter",
  "poster": "poster text",
  "peeling posters": "poster text",
  "sign": "signage",
  "barcode": "symbol",
  "symbols": "symbol",
  "compact disc": "album cover",
  "vinyl record": "album cover",
  "disc": "album cover",
  "music": "album cover",
  "television screens": "screen",
  "screenshots": "screenshot",
  "statue": "sculpture",
  "bronze": "sculpture",
  "illustration ": "illustration",
  "ripples": "water",
  "pool": "water",
  "refraction": "water",
  "water ": "water",
  "gauze": "texture",
  "bandages": "texture",
  "butterflies": "animal",
  "monkey": "animal",
  "microphones": "object",
  "gradient": "abstract",
  "double exposure": "surreal",
  "distorted perspective": "surreal",
  "long exposure": "cinematic",
  "contact sheet": "archival",
  "halftone ": "halftone",
  "triptych": "",
  "collage ": "collage",

  /* moods that were really genres, subjects or judgements */
  "historical": "archival",
  "academic": "philosophy",
  "intellectual": "philosophy",
  "didactic": "philosophy",
  "bureaucratic": "document",
  "administrative": "document",
  "urban": "cityscape",
  "industrial": "brutalist",
  "gothic": "",
  "avant-garde": "conceptual",
  "experimental": "conceptual",
  "realism": "documentary",
  "high fashion": "fashion",
  "fluxus": "conceptual",
  "interview": "documentary",
  "digital": "",
  "clean": "minimalist",
  "simple": "minimalist",
  "structured": "geometric",
  "precise": "geometric",
  "rhythmic": "pattern",
  "stark": "high contrast",
  "cold": "clinical",
  "cool": "clinical",
  "detached": "clinical",
  "aloof": "clinical",
  "formal": "solemn",
  "authoritative": "solemn",
  "serious": "solemn",
  "quiet": "calm",
  "focused": "calm",
  "isolated": "solitary",
  "vast": "ethereal",
  "fragile": "ethereal",
  "enigmatic": "mysterious",
  "cryptic": "mysterious",
  "ominous": "eerie",
  "slightly unsettling": "eerie",
  "disorienting": "eerie",
  "absurdist": "playful",
  "youthful": "playful",
  "dynamic": "energetic",
  "distress": "raw",
  "anguish": "raw",
  "suffering": "raw",
  "candid": "documentary",
  "dramatic": "intense",
  "sophisticated": "",
  "musical": "album cover",
  "artist": "",
};

/**
 * Resolve any raw term to its canonical { name, kind }, or null when it is
 * not a category worth filing under. Plurals fall back to a naive singular
 * so a new "posters" lands on "poster text" rather than minting a twin.
 */
export function canonical(raw: string): { name: string; kind: string } | null {
  const n = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return null;
  if (KIND_OF[n]) return { name: n, kind: KIND_OF[n] };

  const alias = ALIASES[n];
  if (alias === "") return null;
  if (alias && KIND_OF[alias]) return { name: alias, kind: KIND_OF[alias] };

  /* plural -> singular: try every form, shortest edit first, so "statues"
     resolves as "statue" rather than "statu" */
  const singulars = [
    n.endsWith("s") && !n.endsWith("ss") ? n.slice(0, -1) : null,
    n.endsWith("es") && !n.endsWith("ses") ? n.slice(0, -2) : null,
    n.endsWith("ies") ? n.slice(0, -3) + "y" : null,
  ].filter((x): x is string => !!x);
  for (const sg of singulars) {
    if (KIND_OF[sg]) return { name: sg, kind: KIND_OF[sg] };
    const sAlias = ALIASES[sg];
    if (sAlias && KIND_OF[sAlias]) return { name: sAlias, kind: KIND_OF[sAlias] };
  }
  return null;
}

/** The vocabulary as prompt text, so a model picks instead of inventing. */
export function vocabularyBlock(): string {
  return (["subject", "style", "mood", "medium"] as const)
    .map((k) => k + ": " + TAXONOMY[k].join(", "))
    .join("\n");
}
