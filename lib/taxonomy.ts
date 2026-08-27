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
  /* WHAT THE WORK IS -- the archival question, not "was a camera involved".
     A photograph OF a book spread is a book spread; the camera is only its
     carrier. Values name pictorial or graphic works a digital file can
     embody. Physical things -- sculpture, garments, buildings -- are
     subjects DEPICTED by a work, never works here, because a sculpture
     cannot live in a digital archive; only a photograph or scan of it can.
     Names deliberately avoid every subject term (one name, one kind):
     "film frame" not "film still", "record sleeve" not "album cover",
     "technical diagram" not "diagram". */
  work: [
    "photograph", "poster", "book spread", "book cover", "magazine page",
    "record sleeve", "print", "painting", "illustration", "graphic design",
    "collage", "screenshot", "meme", "film frame", "3d render",
    "typeface specimen", "technical diagram", "mixed media",
    /* a photo or scan whose whole content is another artwork -- a sculpture
       in a museum, an installation view, a painting on a gallery wall. The
       depicted thing goes in subjects; the file is a reproduction. */
    "artwork reproduction",
  ],
  /* HOW the work reached this file. "direct" means the file IS the work --
     native digital design, a photographer's own frame. Everything else is a
     reproduction of something that exists outside the file, which is the
     one-bit answer to "is this photographic work or a photo of a thing". */
  carrier: ["direct", "photographed", "scanned", "screen captured"],
  /* WHEN the work most likely dates from -- creation, read from evidence
     (process, dress, typography, printed dates), not the era its style
     merely evokes. "undated" is an honest answer and a worklist. */
  period: [
    "pre-1900", "1900s", "1910s", "1920s", "1930s", "1940s", "1950s",
    "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "undated",
  ],
  /* the physical or displayed substance the work is made of or printed on */
  material: [
    "paper", "newsprint", "cardboard", "cloth", "fabric", "metal", "wood",
    "stone", "ceramic", "glass", "plastic", "film emulsion", "ink", "paint",
    "thread", "screen display",
  ],
  /* the making process, when it can be read off the surface */
  process: [
    "offset", "screen print", "letterpress", "risograph", "etching",
    "lithography", "silver gelatin", "c-print", "polaroid",
    "digital photograph", "digital painting", "vector art", "photocopy",
    "cyanotype", "hand drawn", "embroidery",
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
  /* medium is gone; photography-family answers land on the work kind */
  "photographic": "photograph",
  "photography": "photograph",
  "film photography": "photograph",
  "photo": "photograph",
  "album cover art": "record sleeve",
  "lp cover": "record sleeve",
  "street photography": "documentary",
  "architectural photography": "architecture",
  "grid-based": "grid",
  "grid layout": "grid",
  "layout": "grid",
  "mixed": "mixed media",
  "lithograph": "lithography",
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
  return (["subject", "style", "mood"] as const)
    .map((k) => k + ": " + TAXONOMY[k].join(", "))
    .join("\n");
}

/** the archival facets, for the prompts that assign them */
export function facetBlock(): string {
  return (["work", "carrier", "period", "material", "process"] as const)
    .map((k) => k.toUpperCase() + ": " + TAXONOMY[k].join(", "))
    .join("\n");
}
