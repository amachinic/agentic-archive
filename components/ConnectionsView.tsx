"use client";

/*
  Where the archive reaches outside itself.

  Atlas can only see what you have already collected. A connection widens what
  the Curator can look at -- but not what it can write: a remote image is a
  CANDIDATE until you accept it, and acceptance is the same single door an
  ordinary folder proposal goes through. Nothing here can put a row in the
  library on its own.

  The three readouts on every row exist because "connected" is not one
  question, it is three, and a source can answer them differently. A museum
  aggregator will hand over beautiful metadata and no image bytes. Are.na will
  hand over a URL that points at somebody else's server. Cosmos will hand over
  everything and permit none of it. A row that showed only on/off would let a
  reader assume that switching something on means the agent can catalogue what
  is behind it, and for several of these that is false.

  Secrets are never held in the browser. A source that needs a key names the
  environment variable to set in .env.local, exactly as GROQ_API_KEY already
  works -- a settings page that stashed a token in localStorage would be the
  one genuinely dangerous thing on it.
*/

import { useEffect, useState } from "react";
import { IconCaret, IconCheck, IconX, IconLink } from "./icons";

/** what a source demands before it will answer */
type Access = "open" | "key" | "blocked";

/** how completely a source answers one of the three questions */
type Grade = "full" | "partial" | "none";

type Source = {
  key: string;
  glyph: string;
  name: string;
  host: string;
  access: Access;
  /** one line, what this is and why it is on the list */
  blurb: string;
  /** can Atlas read titles, descriptions, keywords? */
  metadata: [Grade, string];
  /** can Atlas fetch the actual bytes, to fingerprint and catalogue? */
  images: [Grade, string];
  /** is there a licence to keep a copy in the archive? */
  keep: [Grade, string];
  /** the steps, in order, written for someone who has not read the plan */
  setup: string[];
  docs?: string;
  envVar?: string;
  connectable: boolean;
};

const SOURCES: Source[] = [
  {
    key: "arena",
    glyph: "A",
    name: "Are.na",
    host: "dev.are.na",
    access: "open",
    blurb: "Channels of design reference and ephemera — the closest thing on this list to the material this archive already collects, which makes it the fairest test of similarity ranking.",
    metadata: ["full", "titles, descriptions and channel context, unauthenticated"],
    images: ["partial", "many blocks are LINKS to third-party servers, not hosted files — fetching those is a request to someone else's host"],
    keep: ["partial", "no blanket grant; rights follow whatever the original source was"],
    setup: [
      "Nothing to obtain. Public channels answer without any credential.",
      "Switch it on and Atlas may search Are.na when you ask it to look outside.",
      "A credential is only needed to write back to Are.na, which Atlas never does.",
    ],
    docs: "https://dev.are.na/documentation",
    connectable: true,
  },
  {
    key: "rijks",
    glyph: "R",
    name: "Rijksmuseum",
    host: "rijksmuseum.nl",
    access: "key",
    blurb: "The cleanest licence on this page by a distance: object descriptions are CC0 and the images are public domain, so what you fetch is unambiguously yours to keep.",
    metadata: ["full", "CC0 object descriptions"],
    images: ["full", "public-domain images, downloadable"],
    keep: ["full", "free of rights — copy, change, distribute, export without permission"],
    setup: [
      "Create a free Rijksstudio account at rijksmuseum.nl.",
      "Request an API key from the account's advanced settings.",
      "Put it in .env.local as ATLAS_RIJKS_KEY, then restart the dev server.",
      "Switch this on once the key is in place.",
    ],
    docs: "https://data.rijksmuseum.nl/",
    envVar: "ATLAS_RIJKS_KEY",
    connectable: true,
  },
  {
    key: "met",
    glyph: "M",
    name: "The Met",
    host: "collectionapi.metmuseum.org",
    access: "open",
    blurb: "The largest open catalogue here. Strong provenance, but the material sits a long way from posters and editorial — expect low similarity scores and do not read that as the ranking failing.",
    metadata: ["full", "502,398 object records, no registration"],
    images: ["partial", "~368k of 502k records carry an image at all"],
    keep: ["partial", "CC0 covers the metadata dataset and the public-domain image subset, not the catalogue"],
    setup: [
      "Nothing to obtain. The Met asks for no registration of any kind.",
      "Switch it on; Atlas self-throttles well under their 80 requests-per-second ceiling.",
      "Expect occasional 429s from edge protection the docs do not describe — the connector backs off.",
    ],
    docs: "https://metmuseum.github.io/",
    connectable: true,
  },
  {
    key: "artic",
    glyph: "C",
    name: "Art Institute of Chicago",
    host: "api.artic.edu",
    access: "open",
    blurb: "A better editorial and graphic-design fit than most museums, but the tightest anonymous ceiling of the three — their own guidance is to prefer the nightly data dumps over crawling.",
    metadata: ["full", "132,681 artworks, no key"],
    images: ["full", "IIIF image service"],
    keep: ["partial", "62,046 of 132,681 artworks are public domain — 47%"],
    setup: [
      "Nothing to obtain for normal use.",
      "Switch it on. The connector holds to 60 requests per minute, their anonymous limit.",
      "For a bulk first pass, prefer their published data dumps over the API.",
    ],
    docs: "https://api.artic.edu/docs/",
    connectable: true,
  },
  {
    key: "cleveland",
    glyph: "L",
    name: "Cleveland Museum of Art",
    host: "openaccess-api.clevelandart.org",
    access: "open",
    blurb: "The only source here that tells you per record whether the image is yours to keep. That makes it the right one to build the licence-handling code against, even though its material is a weaker fit than Are.na.",
    metadata: ["full", "68,777 records, no key"],
    images: ["full", "direct image URLs on CC0 records"],
    keep: ["partial", "41,507 records ship a CC0 image; ~26k are metadata only — filter cc0=1 and has_image=1"],
    setup: [
      "Nothing to obtain.",
      "Switch it on. No rate limit is published, so the connector self-throttles conservatively.",
      "Atlas requests only records flagged share_license_status = CC0, so nothing unkeepable enters the candidate pool.",
    ],
    docs: "https://openaccess-api.clevelandart.org/",
    connectable: true,
  },
  {
    key: "europeana",
    glyph: "E",
    name: "Europeana",
    host: "api.europeana.eu",
    access: "key",
    blurb: "An aggregator across European institutions rather than one collection, which is its strength and its complication: rights are set by each contributing institution, so they vary record by record.",
    metadata: ["full", "aggregated across thousands of institutions"],
    images: ["partial", "the aggregator links to the providing institution; availability varies"],
    keep: ["partial", "rights statements differ per record — must be read per item, never assumed"],
    setup: [
      "Register a free Europeana account and confirm it.",
      "Request a personal API key from your account section — issued immediately.",
      "A Project key needs approval and takes 1–5 working days; you do not need one for this.",
      "Put the key in .env.local as ATLAS_EUROPEANA_KEY, then restart.",
    ],
    docs: "https://pro.europeana.eu/page/get-api",
    envVar: "ATLAS_EUROPEANA_KEY",
    connectable: true,
  },
  {
    key: "cosmos",
    glyph: "◇",
    name: "Cosmos",
    host: "cosmos.so",
    access: "blocked",
    blurb: "Exactly the material this archive wants, and the reason it keeps coming up. There is no public API; an unofficial MCP server reaches the site's private endpoint, and the terms forbid it.",
    metadata: ["none", "reachable in practice, permitted by nobody"],
    images: ["none", "no licence grant of any kind"],
    keep: ["none", "the terms forbid automated access by any tool that is not a browser, signed in or not"],
    setup: [
      "Not offered. Cosmos publishes no API and issues no keys.",
      "The community MCP server calls an undocumented private endpoint. Its terms §8 forbid access by any tool that is not a generally available browser — which covers the signed-out half too.",
      "Kept on this page so the decision stays visible rather than being re-argued.",
    ],
    docs: "https://www.cosmos.so/legal/terms-conditions",
    connectable: false,
  },
  {
    key: "pinterest",
    glyph: "P",
    name: "Pinterest",
    host: "developers.pinterest.com",
    access: "blocked",
    blurb: "Not what people assume. The API manages pins and boards you already own; it does not search Pinterest, which is the thing anyone actually wants from it.",
    metadata: ["none", "your own boards only, behind per-user OAuth"],
    images: ["none", "no redistribution grant"],
    keep: ["none", "nothing here may be kept in an archive"],
    setup: [
      "Not offered, and not a backlog item.",
      "Trial access caps at 1,000 requests a day and hides everything you create from everyone but you.",
      "Standard access needs an application, a recorded video demo and manual review — all to reach your own content.",
    ],
    docs: "https://developers.pinterest.com/docs/getting-started/access-tiers/",
    connectable: false,
  },
];

const ACCESS_LABEL: Record<Access, string> = {
  open: "no key",
  key: "needs key",
  blocked: "not available",
};

const GRADE_MARK: Record<Grade, string> = { full: "●", partial: "◐", none: "○" };

function Readout({ label, grade, note }: { label: string; grade: Grade; note: string }) {
  return (
    <div className={"conn-read is-" + grade} title={note}>
      <span className="conn-read__mark" aria-hidden="true">{GRADE_MARK[grade]}</span>
      <span className="conn-read__label">{label}</span>
      <span className="conn-read__note">{note}</span>
    </div>
  );
}

export default function ConnectionsView() {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [openSetup, setOpenSetup] = useState<string | null>(null);

  /* Connections are OFF until asked for. A source the reader has never heard
     of should not be quietly reachable on first boot -- unlike the archetypes,
     which are the product, these spend someone else's quota. */
  useEffect(() => {
    try {
      const v = localStorage.getItem("atlas-connections-enabled");
      if (v) setOn(JSON.parse(v));
    } catch { /* first run */ }
  }, []);

  const isOn = (k: string) => on[k] === true;
  const toggle = (k: string) => {
    setOn((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      try { localStorage.setItem("atlas-connections-enabled", JSON.stringify(next)); } catch { /* ok */ }
      return next;
    });
  };

  const live = SOURCES.filter((s) => s.connectable && isOn(s.key)).length;

  return (
    <div className="agents conns">
      <div className="agents__hero">
        <div className="agentcard__top">
          <span className="agentcard__glyph"><IconLink width={15} height={15} /></span>
          <span className="agentcard__name">Connections</span>
          <span className="agentcard__auto is-proposes">proposes</span>
        </div>
        <p className="agentcard__desc">
          A connection widens what Atlas can <em>look at</em>. It does not widen what Atlas can
          write. Anything found outside stays a candidate — fingerprinted, ranked against your own
          archive, shown on the field — until you accept it, and acceptance is the same door every
          folder proposal already goes through.
        </p>
        <div className="agents__doors">
          <span className="agents__door">discover</span>
          <span className="agents__door">rank against yours</span>
          <span className="agents__door">propose</span>
          <span className="agents__door">you accept</span>
        </div>
        <div className="agentcard__foot">
          <span className={"agentcard__status" + (live ? " is-on" : "")}>
            <i />{live ? live + " connected" : "nothing connected"}
          </span>
          <span className="agentcard__budget">runs locally · never on the hosted archive</span>
        </div>
      </div>

      <div className="conns__legend">
        <span className="mono-label">What each row tells you</span>
        <p>
          Connecting a source answers three separate questions, and a source can answer them
          differently. <strong>Data</strong> is whether Atlas can read the record.
          <strong> Images</strong> is whether it can fetch the actual file to fingerprint and
          catalogue. <strong>Keep</strong> is whether the licence lets that file live in your
          archive. A full circle means yes, a half circle means it depends on the record, an empty
          one means no.
        </p>
      </div>

      <div className="conns__rows">
        {SOURCES.map((s) => {
          const enabled = s.connectable && isOn(s.key);
          const setupOpen = openSetup === s.key;
          return (
            <div
              key={s.key}
              className={"conn-row" + (enabled ? " is-live" : "") + (s.connectable ? "" : " is-blocked")}
            >
              <div className="conn-row__head">
                <span className="agentcard__glyph">{s.glyph}</span>
                <div className="conn-row__id">
                  <span className="agentcard__name">{s.name}</span>
                  <span className="conn-row__host">{s.host}</span>
                </div>
                <span className={"agentcard__auto conn-row__access is-" + s.access}>
                  {ACCESS_LABEL[s.access]}
                </span>
                <span className={"agentcard__status conn-row__state" + (enabled ? " is-on" : "")}>
                  <i />
                  {!s.connectable ? "unavailable" : enabled ? "connected" : "off"}
                </span>
                <button
                  className={"agentcard__switch" + (enabled ? " on" : "")}
                  role="switch"
                  aria-checked={enabled}
                  disabled={!s.connectable}
                  aria-label={"Enable " + s.name}
                  title={s.connectable
                    ? (enabled ? "Stop Atlas searching " + s.name : "Let Atlas search " + s.name)
                    : s.name + " cannot be connected"}
                  onClick={() => s.connectable && toggle(s.key)}
                />
              </div>

              <p className="conn-row__blurb">{s.blurb}</p>

              <div className="conn-row__reads">
                <Readout label="Data" grade={s.metadata[0]} note={s.metadata[1]} />
                <Readout label="Images" grade={s.images[0]} note={s.images[1]} />
                <Readout label="Keep" grade={s.keep[0]} note={s.keep[1]} />
              </div>

              <div className="conn-row__actions">
                <button
                  className={"conn-row__connect" + (setupOpen ? " is-open" : "")}
                  onClick={() => setOpenSetup((v) => (v === s.key ? null : s.key))}
                  aria-expanded={setupOpen}
                >
                  {s.connectable
                    ? (enabled ? "Connection details" : s.access === "open" ? "How to connect" : "Get a key")
                    : "Why not"}
                  <IconCaret width={12} height={12} />
                </button>
                {s.envVar && (
                  <span className="conn-row__env"><code>{s.envVar}</code></span>
                )}
              </div>

              {setupOpen && (
                <div className="conn-row__setup">
                  <ol>
                    {s.setup.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                  {s.connectable && s.access === "open" && !enabled && (
                    <button className="conn-row__cta" onClick={() => { toggle(s.key); setOpenSetup(null); }}>
                      <IconCheck width={12} height={12} />
                      Connect {s.name}
                    </button>
                  )}
                  {s.connectable && enabled && (
                    <button className="conn-row__cta is-off" onClick={() => { toggle(s.key); setOpenSetup(null); }}>
                      <IconX width={12} height={12} />
                      Disconnect
                    </button>
                  )}
                  {s.docs && (
                    <a className="conn-row__docs" href={s.docs} target="_blank" rel="noreferrer noopener">
                      {s.connectable ? "Documentation" : "Read their terms"} ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
