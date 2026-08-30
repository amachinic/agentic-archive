/*
  The actual calls. One adapter per source, and every one of them really goes
  out to the network -- there is no stub in this file.

  Two methods, and the first is the important one. `probe()` makes a real,
  cheap request against the source's own API and reports what came back. That
  is what "connect" means here: not a row written optimistically, but a round
  trip that either returned a number or failed with a reason. A settings page
  that reports connected without ever having called the thing is a settings
  page that lies, and this is the file that stops it doing that.

  `search()` is the connector proper: a query in, candidates out, normalised so
  the rest of Atlas never has to know whose JSON it came from.
*/
import { tokenFor, listConnections, type SourceId } from "./connections";

export type Candidate = {
  source: SourceId;
  remoteId: string;
  title: string;
  creator: string | null;
  pageUrl: string | null;
  thumbUrl: string | null;
  /** null when the source will not give us bytes we may keep */
  fullUrl: string | null;
  licence: string | null;
  /** the licence on THIS record permits a copy in the archive */
  keepable: boolean;
};

export type Probe = { detail: string; account?: string | null };

/* The four work-kinds every museum API here can facet on. A keyword can only
   find what catalogue text says; a facet narrows to what the thing IS, which
   is how "paintings about sorrow" stops returning terracotta vases whose
   descriptions mention grief. */
export type Medium = "painting" | "print" | "photograph" | "sculpture";
export const MEDIUMS: Medium[] = ["painting", "print", "photograph", "sculpture"];

export type Adapter = {
  id: SourceId;
  probe(): Promise<Probe>;
  /* items is the bounded PREVIEW; total is the source's own count of what
     the query matched, when its API says so. The cap is a display budget,
     never a knowledge budget: what exists is always reported, even when
     only a sliver of it is fetched. null = the source cannot say (Are.na
     has channels, not a corpus). */
  search(q: string, limit: number, medium?: Medium): Promise<{ items: Candidate[]; total: number | null }>;
};

/** Every outbound call is bounded. A slow source must not hold a request open. */
const TIMEOUT = 12_000;

/* Base URLs are overridable so the two credentialed sources can be exercised
   against a fixture. Nothing else changes: the same parsing runs either way,
   which is the point -- a test that reimplemented the parsing would prove
   nothing about this file. Unset in normal use. */
const EUROPEANA_BASE = process.env.ATLAS_EUROPEANA_BASE?.trim() || "https://api.europeana.eu";
const PINTEREST_BASE = process.env.ATLAS_PINTEREST_BASE?.trim() || "https://api.pinterest.com";

/** who Atlas says it is to the Art Institute; theirs is a required header */
export const AIC_UA = process.env.ATLAS_CONTACT?.trim()
  ? "Atlas Agentic Archive (" + process.env.ATLAS_CONTACT.trim() + ")"
  : "Atlas Agentic Archive (personal image archive)";

/* Hosts /api/sources/thumb may fetch from — the known image CDNs of the
   connected sources, nothing else. This list is an allowlist, not a
   suggestion: the route refuses anything not on it, so it can never become
   an open proxy. The client tries every thumbnail DIRECT first (the
   viewer's own network is usually welcome where a datacenter's is not —
   the AIC flags server egress but serves ordinary browsers) and falls back
   to the proxy, so every host a tile might need to route through is here. */
export const PROXY_HOSTS = new Set([
  "www.artic.edu", "artic.edu",
  "images.metmuseum.org",
  "openaccess-cdn.clevelandart.org",
  "d2w9rnfcy7mm78.cloudfront.net", "images.are.na", "attachments.are.na",
  "api.europeana.eu",
]);

export function proxied(url: string | null): string | null {
  if (!url) return null;
  try {
    if (!PROXY_HOSTS.has(new URL(url).hostname)) return url;
    return "/api/sources/thumb?url=" + encodeURIComponent(url);
  } catch { return url; }
}

class SourceError extends Error {}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": "Atlas/AgenticArchive (personal image archive)",
        /* The Art Institute asks callers to identify themselves with this
           header, and it is not a courtesy: measured against their IIIF
           service, the same URL is 403 without it and image/jpeg with it.
           Sending it everywhere is harmless and honest. */
        "AIC-User-Agent": AIC_UA,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError"
      ? "it did not answer within " + TIMEOUT / 1000 + "s"
      : "the request could not be made";
    throw new SourceError(why);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SourceError("the credential was refused (" + res.status + ")");
  }
  if (res.status === 429) throw new SourceError("rate limited (429) â€” try again shortly");
  if (!res.ok) throw new SourceError("it answered " + res.status);
  try {
    return await res.json() as T;
  } catch {
    throw new SourceError("it answered with something that was not JSON");
  }
}

const n = (v: unknown) => typeof v === "number" ? v.toLocaleString("en-GB") : "?";

/* ---------------------------------------------------------------- The Met */
const met: Adapter = {
  id: "met",
  async probe() {
    const d = await getJson<{ total?: number }>(
      "https://collectionapi.metmuseum.org/public/collection/v1/objects");
    return { detail: n(d.total) + " objects catalogued" };
  },
  async search(q, limit, medium) {
    /* medium=Paintings cut a "sorrow" probe from 337 hits to 113, measured:
       the difference between works about sorrow and works that mention it */
    const facet: Record<Medium, string> = {
      painting: "Paintings", print: "Prints", photograph: "Photographs", sculpture: "Sculpture",
    };
    const s = await getJson<{ objectIDs?: number[] | null }>(
      "https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true" +
      (medium ? "&medium=" + facet[medium] : "") + "&q=" + encodeURIComponent(q));
    /* the full ID list IS the true match count — keep it before slicing */
    const all = s.objectIDs ?? [];
    const ids = all.slice(0, limit);
    const out: Candidate[] = [];
    /* one round trip per object is the Met's price; pay it eight at a time
       so a deep probe (count=100) lands in seconds, not half a minute */
    for (let i = 0; i < ids.length; i += 8) {
      const chunk = await Promise.all(ids.slice(i, i + 8).map(async (id) => {
        try {
          const o = await getJson<{
            objectID: number; title?: string; artistDisplayName?: string;
            primaryImageSmall?: string; primaryImage?: string;
            objectURL?: string; isPublicDomain?: boolean;
          }>("https://collectionapi.metmuseum.org/public/collection/v1/objects/" + id);
          if (!o.primaryImageSmall) return null;
          return {
            source: "met" as const, remoteId: String(o.objectID),
            title: o.title || "Untitled",
            creator: o.artistDisplayName || null,
            pageUrl: o.objectURL ?? null,
            thumbUrl: o.primaryImageSmall,
            fullUrl: o.isPublicDomain ? (o.primaryImage || o.primaryImageSmall) : null,
            licence: o.isPublicDomain ? "CC0" : "in copyright",
            keepable: !!o.isPublicDomain,
          };
        } catch { return null; /* one bad object must not fail the search */ }
      }));
      for (const c of chunk) if (c) out.push(c);
    }
    return { items: out, total: all.length };
  },
};

/* ------------------------------------------- Art Institute of Chicago */
const artic: Adapter = {
  id: "artic",
  async probe() {
    const d = await getJson<{ pagination?: { total?: number } }>(
      "https://api.artic.edu/api/v1/artworks?limit=1");
    return { detail: n(d.pagination?.total) + " artworks catalogued" };
  },
  async search(q, limit, medium) {
    const fields = "id,title,artist_title,image_id,is_public_domain";
    /* the .keyword suffix matters: the analysed field matches nothing for an
       exact term, and "The Old Guitarist" only surfaces with it — measured */
    const facet: Record<Medium, string> = {
      painting: "Painting", print: "Print", photograph: "Photograph", sculpture: "Sculpture",
    };
    const d = await getJson<{ data?: Array<{
      id: number; title?: string; artist_title?: string | null;
      image_id?: string | null; is_public_domain?: boolean;
    }>; config?: { iiif_url?: string }; pagination?: { total?: number } }>(
      "https://api.artic.edu/api/v1/artworks/search?q=" + encodeURIComponent(q) +
      (medium ? "&query%5Bterm%5D%5Bartwork_type_title.keyword%5D=" + facet[medium] : "") +
      "&limit=" + limit + "&fields=" + fields);
    const iiif = d.config?.iiif_url || "https://www.artic.edu/iiif/2";
    const items = (d.data ?? []).filter((a) => a.image_id).map((a) => ({
      source: "artic" as const, remoteId: String(a.id),
      title: a.title || "Untitled",
      creator: a.artist_title ?? null,
      pageUrl: "https://www.artic.edu/artworks/" + a.id,
      /* DIRECT, deliberately: the viewer's browser usually loads AIC's IIIF
         fine, while the server's egress is flagged — the client falls back
         to the proxy, then to the title card */
      thumbUrl: iiif + "/" + a.image_id + "/full/400,/0/default.jpg",
      fullUrl: a.is_public_domain ? proxied(iiif + "/" + a.image_id + "/full/1686,/0/default.jpg") : null,
      licence: a.is_public_domain ? "public domain" : "in copyright",
      keepable: !!a.is_public_domain,
    }));
    return { items, total: d.pagination?.total ?? null };
  },
};

/* ------------------------------------------ Cleveland Museum of Art */
const cleveland: Adapter = {
  id: "cleveland",
  async probe() {
    const all = await getJson<{ info?: { total?: number } }>(
      "https://openaccess-api.clevelandart.org/api/artworks/?limit=1");
    const cc0 = await getJson<{ info?: { total?: number } }>(
      "https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=1");
    return { detail: n(cc0.info?.total) + " CC0 images of " + n(all.info?.total) + " records" };
  },
  async search(q, limit, medium) {
    /* cc0=1 and has_image=1 at the query, so nothing unkeepable is ever even
       offered as a candidate */
    const facet: Record<Medium, string> = {
      painting: "Painting", print: "Print", photograph: "Photograph", sculpture: "Sculpture",
    };
    const d = await getJson<{ data?: Array<{
      id: number; title?: string; creators?: Array<{ description?: string }>;
      url?: string; images?: { web?: { url?: string }; print?: { url?: string } };
      share_license_status?: string;
    }>; info?: { total?: number } }>("https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=" +
      limit + (medium ? "&type=" + facet[medium] : "") + "&q=" + encodeURIComponent(q));
    const items = (d.data ?? []).map((a) => ({
      source: "cleveland" as const, remoteId: String(a.id),
      title: a.title || "Untitled",
      creator: a.creators?.[0]?.description ?? null,
      pageUrl: a.url ?? null,
      thumbUrl: a.images?.web?.url ?? null,
      fullUrl: a.images?.print?.url ?? a.images?.web?.url ?? null,
      licence: a.share_license_status || "CC0",
      keepable: (a.share_license_status || "CC0").toUpperCase() === "CC0",
    }));
    return { items, total: d.info?.total ?? null };
  },
};

/* ------------------------------------------------------- Rijksmuseum
   The key-based collection API at www.rijksmuseum.nl is GONE -- it answers
   410, not 401, so no key would revive it. What replaced it is a keyless
   Linked Art search at data.rijksmuseum.nl.

   Honest limitation, stated here because the UI states it too: an image is
   four dereferences away (search -> HumanMadeObject -> VisualItem ->
   DigitalObject -> access point). That is far too many round trips to do per
   candidate, so this connector returns metadata and a page link and no
   thumbnail. It is a catalogue to search, not a source to acquire from. */
const RIJKS_SEARCH = "https://data.rijksmuseum.nl/search/collection";

const rijks: Adapter = {
  id: "rijks",
  async probe() {
    const d = await getJson<{ partOf?: { totalItems?: number } }>(
      RIJKS_SEARCH + "?imageAvailable=True&type=painting");
    return { detail: n(d.partOf?.totalItems) + " paintings with images" };
  },
  async search(q, limit, medium) {
    const d = await getJson<{ orderedItems?: Array<{ id: string }>; partOf?: { totalItems?: number } }>(
      RIJKS_SEARCH + "?imageAvailable=True" + (medium ? "&type=" + medium : "") +
      "&title=" + encodeURIComponent(q));
    const ids = (d.orderedItems ?? []).slice(0, Math.min(limit, 8));
    const out: Candidate[] = [];
    for (const it of ids) {
      try {
        const o = await getJson<{
          identified_by?: Array<{ type?: string; content?: string }>;
          subject_of?: Array<{ digitally_carried_by?: Array<{ access_point?: Array<{ id?: string }> }> }>;
        }>(it.id);
        const title = o.identified_by?.find((n2) => n2.type === "Name" && n2.content)?.content
          ?? o.identified_by?.find((n2) => n2.content)?.content
          ?? "Untitled";
        const page = o.subject_of?.[0]?.digitally_carried_by?.[0]?.access_point?.[0]?.id ?? it.id;
        out.push({
          source: "rijks", remoteId: it.id.split("/").pop() || it.id,
          title, creator: null, pageUrl: page,
          thumbUrl: null, fullUrl: null,
          licence: "public domain (metadata)",
          keepable: false,
        });
      } catch { /* one unreachable object must not fail the search */ }
    }
    return { items: out, total: d.partOf?.totalItems ?? null };
  },
};

/* --------------------------------------------------------- Europeana */
const europeana: Adapter = {
  id: "europeana",
  async probe() {
    const key = process.env.ATLAS_EUROPEANA_KEY?.trim();
    if (!key) throw new SourceError("ATLAS_EUROPEANA_KEY is not set");
    const d = await getJson<{ totalResults?: number; success?: boolean; error?: string }>(
      EUROPEANA_BASE + "/record/v2/search.json?wskey=" + encodeURIComponent(key) +
      "&query=*%3A*&rows=0&media=true");
    if (d.success === false) throw new SourceError(d.error || "Europeana refused the key");
    return { detail: n(d.totalResults) + " records with media" };
  },
  async search(q, limit) {
    const key = process.env.ATLAS_EUROPEANA_KEY?.trim() ?? "";
    const d = await getJson<{ totalResults?: number; items?: Array<{
      id: string; title?: string[]; dcCreator?: string[];
      guid?: string; edmPreview?: string[]; rights?: string[];
    }> }>(EUROPEANA_BASE + "/record/v2/search.json?wskey=" + encodeURIComponent(key) +
      "&rows=" + limit + "&media=true&query=" + encodeURIComponent(q));
    const items = (d.items ?? []).map((i) => {
      const rights = i.rights?.[0] ?? null;
      /* only the genuinely open rights statements count as keepable; anything
         else is a lead, not an acquisition */
      const open = !!rights && /creativecommons\.org\/(publicdomain|licenses\/by)/.test(rights);
      return {
        source: "europeana" as const, remoteId: i.id,
        title: i.title?.[0] || "Untitled",
        creator: i.dcCreator?.[0] ?? null,
        pageUrl: i.guid ?? null,
        thumbUrl: i.edmPreview?.[0] ?? null,
        fullUrl: open ? i.edmPreview?.[0] ?? null : null,
        licence: rights,
        keepable: open,
      };
    });
    return { items, total: d.totalResults ?? null };
  },
};

/* ------------------------------------------------------------- Are.na
   Keyless, but not by the obvious route. Measured against the live API:
   /v2/me is 410 GONE, and /v2/search/blocks answers 403 without a token --
   block search is the part they gate. What IS open is /v2/search (which
   returns channels) and /v2/channels/{slug}/contents, so the working path is
   to find channels for the query and read their contents. Four requests
   instead of one, and no credential at all. */
const ARENA = "https://api.are.na/v2";

type ArenaBlock = {
  id: number; class?: string; title?: string | null; generated_title?: string | null;
  source?: { url?: string } | null;
  image?: { thumb?: { url?: string }; display?: { url?: string }; original?: { url?: string } } | null;
};

const arena: Adapter = {
  id: "arena",
  async probe() {
    const d = await getJson<{ channels?: unknown[] }>(ARENA + "/channels?per=1");
    return { detail: Array.isArray(d.channels) ? "public channels reachable" : "reachable" };
  },
  async search(q, limit) {
    const out: Candidate[] = [];
    const seen = new Set<number>();
    const push = (b: ArenaBlock) => {
      const thumb = b.image?.thumb?.url;
      if (!thumb || seen.has(b.id) || out.length >= limit) return;
      seen.add(b.id);
      out.push({
        source: "arena", remoteId: String(b.id),
        title: b.title || b.generated_title || "Untitled",
        creator: null,
        pageUrl: b.source?.url ?? "https://www.are.na/block/" + b.id,
        thumbUrl: thumb,
        /* Are.na attaches no rights to a block, so nothing from it is ever
           keepable: it is a lead back to an original, not an acquisition */
        fullUrl: null,
        licence: null,
        keepable: false,
      });
    };
    /* /v2/search answers keyless with BLOCKS as well as channels — measured:
       a compound query ("melancholic dark muted") that matches no channel
       NAME still returns image blocks here. A refined hunt used to come
       back empty because only channel names were consulted; the blocks are
       the direct answer, the channels the supplement. */
    const s = await getJson<{ blocks?: ArenaBlock[] | null; channels?: Array<{ slug?: string }> }>(
      ARENA + "/search?per=" + Math.min(24, limit * 3) + "&q=" + encodeURIComponent(q));
    for (const b of s.blocks ?? []) push(b);
    const slugs = (s.channels ?? []).map((c) => c.slug).filter(Boolean).slice(0, 3) as string[];
    for (const slug of slugs) {
      if (out.length >= limit) break;
      try {
        /* a channel's first blocks are often text and links; ask for a full
           page so the IMAGES in it are actually reached (measured) */
        const c = await getJson<{ contents?: ArenaBlock[] | null }>(
          ARENA + "/channels/" + encodeURIComponent(slug) + "/contents?per=24");
        for (const b of c.contents ?? []) push(b);
      } catch { /* a private or empty channel must not fail the search */ }
    }
    /* Are.na has channels, not a corpus: there is no honest total */
    return { items: out, total: null };
  },
};

/* ---------------------------------------------------------- Pinterest */
const pinterest: Adapter = {
  id: "pinterest",
  async probe() {
    const token = tokenFor("pinterest");
    if (!token) throw new SourceError("no Pinterest authorisation â€” connect the account first");
    const me = await getJson<{ username?: string; board_count?: number; pin_count?: number }>(
      PINTEREST_BASE + "/v5/user_account",
      { headers: { Authorization: "Bearer " + token } });
    const boards = typeof me.board_count === "number" ? n(me.board_count) + " boards" : "authorised";
    return { detail: boards, account: me.username ?? null };
  },
  async search(q, limit) {
    /* Pinterest has no public search. "Search" here means YOUR pins, filtered
       locally by note or title -- which is the only thing the API will serve
       and the only thing this product claims. */
    const token = tokenFor("pinterest");
    if (!token) throw new SourceError("no Pinterest authorisation");
    const d = await getJson<{ items?: Array<{
      id: string; title?: string | null; note?: string | null; link?: string | null;
      media?: { images?: Record<string, { url?: string }> };
    }> }>(PINTEREST_BASE + "/v5/pins?page_size=" + Math.min(100, limit * 4),
      { headers: { Authorization: "Bearer " + token } });
    const needle = q.trim().toLowerCase();
    const hits = (d.items ?? [])
      .filter((p) => !needle || (p.title || p.note || "").toLowerCase().includes(needle));
    const items = hits
      .slice(0, limit)
      .map((p) => {
        const imgs = p.media?.images ?? {};
        const pick = imgs["600x"] ?? imgs["400x300"] ?? imgs["1200x"] ?? Object.values(imgs)[0];
        return {
          source: "pinterest" as const, remoteId: p.id,
          title: p.title || p.note || "Untitled pin",
          creator: null,
          pageUrl: p.link ?? "https://www.pinterest.com/pin/" + p.id,
          thumbUrl: pick?.url ?? null,
          fullUrl: pick?.url ?? null,
          licence: null,
          keepable: false,
        };
      });
    /* the count is of the fetched page of YOUR pins, not a corpus — the
       only population Pinterest's API will admit to */
    return { items, total: null };
  },
};

export const ADAPTERS: Record<SourceId, Adapter> = {
  met, artic, cleveland, rijks, europeana, arena, pinterest,
};

/** The message a human should see when a source refuses. */
export function reason(e: unknown): string {
  if (e instanceof SourceError) return e.message;
  if (e instanceof Error) return e.message;
  return "the connection could not be made";
}

export type OutsideSearch = {
  results: Candidate[];
  searched: SourceId[];
  failed: { source: SourceId; error: string }[];
  /* what each source says the query MATCHED — the population behind the
     preview. null where a source cannot say. */
  totals: { source: SourceId; total: number | null }[];
};

/**
 * One query across every CONNECTED source, in parallel. The single
 * implementation behind both /api/sources/search and the agent's
 * search_outside tool, so the two can never disagree about what a search
 * means. A source that fails is reported beside the results rather than
 * taking the search down: one slow museum must not cost the other four.
 */
export async function searchConnected(
  q: string,
  opts: { limit?: number; only?: SourceId | null; medium?: Medium | null; allow?: SourceId[] | null } = {},
): Promise<OutsideSearch> {
  const limit = Math.max(1, Math.min(40, opts.limit ?? 12));
  /* `allow` is the caller's own gate, and it NARROWS the connected set —
     it can never widen it. The agent passes the sources it was actually
     allowed this turn (the reader may have switched some off), and without
     this the sweep would quietly re-derive the full list from the database
     and search a source the reader had just turned off. */
  const live = listConnections().filter((c) => c.status !== "off").map((c) => c.id);
  const allowed = opts.allow ? live.filter((id) => opts.allow!.includes(id)) : live;
  const targets = opts.only ? allowed.filter((id) => id === opts.only) : allowed;

  const settled = await Promise.all(targets.map(async (id) => {
    try {
      const r = await ADAPTERS[id].search(q, limit, opts.medium ?? undefined);
      return { id, items: r.items, total: r.total };
    } catch (e) {
      return { id, items: [] as Candidate[], total: null, error: reason(e) as string | undefined };
    }
  }));

  return {
    results: settled.flatMap((s) => s.items),
    searched: targets,
    failed: settled.filter((s) => s.error).map((s) => ({ source: s.id, error: s.error! })),
    totals: settled.map((s) => ({ source: s.id, total: s.total })),
  };
}

