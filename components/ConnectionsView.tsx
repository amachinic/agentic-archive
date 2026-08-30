"use client";

/*
  Where the archive reaches outside itself.

  Two kinds of source, and the split is the page's whole structure. An image
  platform is somewhere you already have an account and things saved in it, so
  connecting means authorising and bringing YOUR curation home. A museum is an
  open collection: usually nothing to sign, but the licence sits on the record
  rather than the source, so "open access" never means all of it is yours.

  A connection widens what Atlas can LOOK AT, never what it can write. Anything
  found outside stays a candidate until you accept it, through the same door an
  ordinary folder proposal goes through.

  A source is simply on or off, and it says so with the same switch the
  Agents page uses -- one component for one idea, across both pages under
  AGENTS.

  But the switch is not a setting. State is the SERVER's, not the browser's:
  the first version of this page kept toggles in localStorage, so it could
  cheerfully claim a source was on while no credential existed anywhere -- a
  settings screen that lies. Turning one on now CALLS the source, and the
  switch refuses to move until it answers. Mid-probe the thumb breathes where
  it stands, the dot beside it reads "connecting…", and a refusal leaves the
  switch exactly where it was with the reason printed on the card. The only
  way to show "on" is to have actually reached the thing.

  Pinterest wears the same pill and means something different by it: there is
  no probe to run, only an authorisation, so flipping it leaves for Pinterest
  and comes back through the OAuth callback. The card says so under it.

  ON THE HOSTED ARCHIVE the switch means the third thing. Nothing can connect
  there -- the open collections are simply available, and a public deployment
  has no visitor accounts for a credential to live in -- so a switch that
  wrote to the server would either lie or let one reader disable the Met for
  everybody. What it does instead is answer the same question for YOU: will
  Atlas look here in my hunts? That preference is yours alone, kept in your
  own browser and sent with each request, so the tool the agent gets offered
  is genuinely narrowed. A source that needs a credential stays inert there,
  because no preference of yours can conjure one.
*/

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconAlert, IconCaret, IconCheck, IconX, IconLink } from "./icons";

type Grade = "full" | "partial" | "none";
type Auth = "none" | "key" | "oauth";

type Source = {
  id: string;
  glyph: string;
  name: string;
  host: string;
  auth: Auth;
  /** one line. Only where there is something non-obvious to say. */
  line: string;
  metadata: [Grade, string];
  images: [Grade, string];
  keep: [Grade, string];
  setup: string[];
  docs: string;
};

type Category = { key: string; title: string; lede: string; sources: Source[] };

const CATEGORIES: Category[] = [
  {
    key: "platforms",
    title: "Image platforms",
    lede: "Bring your own curation home. Atlas connects to your account and imports what you already saved.",
    sources: [
      {
        id: "arena", glyph: "A", name: "Are.na", host: "api.are.na", auth: "none",
        line: "Open API, no key. Searches public channels and reads their blocks.",
        metadata: ["full", "block titles and the channel each one sits in"],
        images: ["full", "thumbnails resolve, though many blocks are re-posted from elsewhere"],
        keep: ["none", "no licence metadata at all — treat a block as a lead to its original source"],
        setup: [
          "Nothing to obtain. Public channels and their contents answer without a credential.",
          "Block search is the one gated part of their API, so Atlas searches channels and reads what is in them.",
        ],
        docs: "https://dev.are.na/documentation",
      },
      {
        id: "pinterest", glyph: "P", name: "Pinterest", host: "api.pinterest.com", auth: "oauth",
        line: "Personal account only — the API reads the boards you own, not all of Pinterest.",
        metadata: ["full", "board names, pin notes, links and privacy"],
        images: ["full", "pin image URLs, fetchable for fingerprinting"],
        keep: ["partial", "no redistribution grant; keeping what you saved is the act you already performed"],
        setup: [
          "Create an app at developers.pinterest.com.",
          "Register this redirect URI: http://localhost:4400/api/connect/pinterest/callback",
          "Put the credentials in .env.local as ATLAS_PINTEREST_APP_ID and ATLAS_PINTEREST_SECRET, then restart.",
          "Press Connect. Atlas asks for boards:read and pins:read and nothing else.",
        ],
        docs: "https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/",
      },
    ],
  },
  {
    key: "museums",
    title: "Museums and galleries",
    lede: "Open collections published for reuse. The licence sits on the record, not the source.",
    sources: [
      {
        id: "rijks", glyph: "R", name: "Rijksmuseum", host: "data.rijksmuseum.nl", auth: "none",
        line: "Keyless Linked Art catalogue. Metadata and page links only — no thumbnails.",
        metadata: ["full", "titles and object pages, no key required"],
        images: ["none", "an image is four dereferences deep in their Linked Art graph — too many round trips per candidate, so this connector does not fetch them"],
        keep: ["none", "the works are public domain, but Atlas cannot reach the files through this API"],
        setup: [
          "Nothing to obtain. The old key-based API at rijksmuseum.nl now answers 410; its keyless replacement needs no credential.",
          "Use it to find things. Acquiring an image means opening the object page yourself.",
        ],
        docs: "https://data.rijksmuseum.nl/docs/search",
      },
      {
        id: "met", glyph: "M", name: "The Met", host: "collectionapi.metmuseum.org", auth: "none",
        line: "502,398 objects. Far broader than painting — textiles, photography, design.",
        metadata: ["full", "502,398 records, no registration"],
        images: ["partial", "~368k of 502k records carry an image"],
        keep: ["partial", "CC0 on the metadata and the public-domain image subset only"],
        setup: ["Nothing to obtain. Atlas holds under their 80-per-second ceiling and backs off on 429s."],
        docs: "https://metmuseum.github.io/",
      },
      {
        id: "artic", glyph: "C", name: "Art Institute of Chicago", host: "api.artic.edu", auth: "none",
        line: "132,681 artworks with IIIF images. Strong on photography and graphic design.",
        metadata: ["full", "132,681 artworks"],
        images: ["full", "IIIF image service"],
        keep: ["partial", "62,046 of 132,681 are public domain"],
        setup: ["Nothing to obtain. Atlas holds to their 60-per-minute anonymous limit and prefers the nightly dumps for bulk."],
        docs: "https://api.artic.edu/docs/",
      },
      {
        id: "cleveland", glyph: "L", name: "Cleveland Museum of Art", host: "openaccess-api.clevelandart.org", auth: "none",
        line: "States per record whether the image is yours to keep.",
        metadata: ["full", "68,777 records"],
        images: ["full", "direct URLs on CC0 records"],
        keep: ["partial", "41,507 ship a CC0 image; ~26k are metadata only"],
        setup: ["Nothing to obtain. Atlas requests only records flagged share_license_status = CC0."],
        docs: "https://openaccess-api.clevelandart.org/",
      },
      {
        id: "europeana", glyph: "E", name: "Europeana", host: "api.europeana.eu", auth: "key",
        line: "Thousands of European institutions aggregated — deep in posters and print.",
        metadata: ["full", "aggregated across contributors"],
        images: ["partial", "links out to the providing institution"],
        keep: ["partial", "rights differ per contributing institution"],
        setup: [
          "Register a free Europeana account and request a personal API key — issued immediately.",
          "Put it in .env.local as ATLAS_EUROPEANA_KEY, then restart.",
        ],
        docs: "https://pro.europeana.eu/page/get-api",
      },
    ],
  },
];

const ALL = CATEGORIES.flatMap((c) => c.sources);
const MARK: Record<Grade, string> = { full: "●", partial: "◐", none: "○" };
/* read by GraphView too: the sources this reader has asked Atlas to skip */
export const MUTED_KEY = "atlas-sources-muted";

type State = {
  id: string; status: "off" | "enabled" | "connected";
  account: string | null; ready: boolean; missing: string[];
  detail: string | null; lastError: string | null;
};

/* A confirmation is transient; a failure is not. Something that went right is
   worth a glance and then gone, but a reason a connection failed has to stay
   on screen long enough to be acted on -- auto-dismissing it would hide the
   one piece of information the reader actually needs. */
type Toast = { id: number; kind: "ok" | "bad"; text: string };

/* What flipping this particular switch will actually do — spoken plainly,
   because identical pills mean different things: an open source probes and
   settles, one still missing its credentials cannot probe at all, an OAuth
   one leaves the page for the provider, and on the hosted archive the
   switch only reports, since nothing there can connect. */
function switchTitle(s: Source, on: boolean, st: State | undefined, hosted: boolean): string {
  if (hosted) {
    /* available here, so the switch is yours: it decides whether Atlas
       looks in this collection during YOUR hunts */
    if (st && st.status !== "off") {
      return on
        ? "Atlas searches " + s.name + " in your hunts — switch off to skip it"
        : "Atlas is skipping " + s.name + " — switch on to search it again";
    }
    return s.name + " needs a credential, so it connects only in the local runtime";
  }
  if (on) return "Switch off " + s.name;
  if (st && !st.ready) return s.name + " needs its credentials first — see Setup";
  if (s.auth === "oauth") return "Authorise " + s.name + " — opens " + s.name;
  return "Switch on " + s.name + " — Atlas calls the source to check it answers";
}

export default function ConnectionsView() {
  const [states, setStates] = useState<Record<string, State>>({});
  /* the public archive: open sources are available, nothing connects */
  const [hosted, setHosted] = useState(false);
  /* the hosted reader's own choice of where Atlas may look, theirs alone */
  const [muted, setMuted] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const params = useSearchParams();

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, text }]);
    if (kind === "ok") {
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    }
  }, []);
  const drop = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/connections");
      const d = await r.json() as { hosted?: boolean; connections?: State[] };
      const next: Record<string, State> = {};
      for (const c of d.connections ?? []) next[c.id] = c;
      setStates(next);
      setHosted(d.hosted === true);
    } catch { /* the page still renders; every row simply reads off */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    try { setMuted(JSON.parse(localStorage.getItem(MUTED_KEY) || "[]") as string[]); } catch { /* first visit */ }
  }, []);

  /* Skipping a source is a preference, not a connection: it is written here
     and read by the prompt panel, which sends it with every turn so the
     agent is offered a genuinely narrower tool. */
  function mute(id: string, off: boolean) {
    setMuted((m) => {
      const next = off ? [...new Set([...m, id])] : m.filter((x) => x !== id);
      try { localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
  }

  /* The OAuth callback lands back here with an outcome. */
  useEffect(() => {
    const r = params.get("connect");
    if (!r) return;
    if (r === "cancelled") push("bad", "Pinterest authorisation was cancelled.");
    else if (r === "failed") push("bad", params.get("why") || "That connection did not complete.");
    else push("ok", "Pinterest connected.");
    window.history.replaceState({}, "", "/agents/connections");
    void load();
  }, [params, push, load]);

  async function act(s: Source, on: boolean) {
    /* The guard lives HERE rather than on the button's disabled attribute.
       Disabling the very control you just pressed makes the browser drop
       focus to <body> mid-probe, and it never comes back -- a keyboard user
       could switch a source on and then be unable to switch it off without
       hunting for the control again. The switch stays focusable and says
       aria-disabled while it works; this line is what actually stops a
       second press from firing. */
    if (busy === s.id) return;
    if (s.auth === "oauth" && !on) {
      const st = states[s.id];
      if (!st?.ready) {
        setOpenId(s.id);
        push("bad", "Set " + (st?.missing.join(" and ") || "the credentials") + " in .env.local, then restart the server.");
        return;
      }
      /* by source id, so a second account source needs a route and nothing
         here — the door is the same shape for every provider */
      window.location.href = "/api/connect/" + s.id;
      return;
    }
    setBusy(s.id);
    try {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: s.id, action: on ? "disable" : "enable" }),
      });
      const d = await r.json() as { error?: string; message?: string; connections?: State[] };
      if (d.connections) {
        const next: Record<string, State> = {};
        for (const c of d.connections) next[c.id] = c;
        setStates(next);
      }
      if (!r.ok) {
        push("bad", d.error || "That did not go through.");
        setOpenId(s.id);
      } else if (on) {
        push("ok", s.name + " disconnected.");
      } else {
        push("ok", d.message || s.name + " connected.");
      }
    } catch {
      push("bad", "The archive did not answer. Check the server is still running.");
    }
    setBusy(null);
  }

  /* One reading of "on", used by the cards and by every count, so the
     header can never disagree with the switches underneath it. */
  const isOn = useCallback((id: string) => {
    const st = states[id];
    const available = !!st && st.status !== "off";
    return hosted ? available && !muted.includes(id) : available;
  }, [states, hosted, muted]);
  const liveCount = ALL.filter((s) => isOn(s.id)).length;

  return (
    <div className="conns">
      <header className="conns__intro">
        <h1>Connections</h1>
        <p>
          Bring your references home. Atlas searches connected sources, ranks what it finds against
          your own archive, and stages anything worth keeping as a proposal you accept.
        </p>
        <div className="conns__meta">
          <span className={"conn-live" + (liveCount ? " is-on" : "")}>
            <i />{liveCount
              ? liveCount + " of " + ALL.length + (hosted ? " searched" : " connected")
              : hosted ? "searching nothing" : "nothing connected"}
          </span>
          {hosted
            ? <span>The open collections are searchable here — switch any of them off and Atlas skips it in your hunts. Accounts and keys connect only in the local runtime.</span>
            : <span>Runs locally. Credentials live in <code>.env.local</code>, never in the browser.</span>}
        </div>
      </header>

      {/* Failures live IN the page, above the rows they explain, and stay
          until dismissed. Confirmations are a different thing: a glance, not
          a document, so they float over the corner and clear themselves. */}
      {toasts.some((t) => t.kind === "bad") && (
        <div className="conns__toasts">
          {toasts.filter((t) => t.kind === "bad").map((t) => (
            <div key={t.id} className="toast is-bad" role="alert">
              <span className="toast__mark" aria-hidden="true"><IconAlert width={13} height={13} /></span>
              <span className="toast__text">{t.text}</span>
              <button className="toast__x" onClick={() => drop(t.id)} aria-label="Dismiss">
                <IconX width={11} height={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {toasts.some((t) => t.kind === "ok") && (
        <div className="conns__float" aria-live="polite">
          {toasts.filter((t) => t.kind === "ok").map((t) => (
            <div key={t.id} className="toast is-ok" role="status">
              <span className="toast__mark" aria-hidden="true"><IconCheck width={12} height={12} /></span>
              <span className="toast__text">{t.text}</span>
              <button className="toast__x" onClick={() => drop(t.id)} aria-label="Dismiss">
                <IconX width={11} height={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {CATEGORIES.map((cat) => (
        <section key={cat.key} className="conns__cat">
          <div className="conns__cathead">
            <h2>{cat.title}</h2>
            <span className="conns__catcount">
              {cat.sources.filter((s) => isOn(s.id)).length} / {cat.sources.length}
            </span>
          </div>
          <p className="conns__catlede">{cat.lede}</p>

          <div className="conns__grid">
            {cat.sources.map((s) => {
              const st = states[s.id];
              /* what the SERVER holds: connected, or available-here */
              const available = !!st && st.status !== "off";
              /* what the switch shows. Locally that is the connection
                 itself; on the hosted archive it is this reader's own
                 answer to "may Atlas look here?" */
              const on = isOn(s.id);
              /* hosted sources needing a credential can never come on: no
                 preference of the reader's conjures one */
              const inert = hosted && !available;
              /* An account source that has never been authorised has no
                 state to toggle YET, and a switch is the wrong promise for
                 it: the act is not "turn this on", it is "leave for
                 Pinterest, sign in, and come back". That gets a button that
                 says so. Once authorised it becomes an ordinary switch, so
                 signing out reads the same as switching anything else off. */
              const needsAuth = !hosted && s.auth === "oauth" && !available;
              const open = openId === s.id;
              const probing = busy === s.id;
              return (
                <article key={s.id} className={"conncard" + (on ? " is-live" : "")}>
                  <div className="conncard__top">
                    <span className="agentcard__glyph">{s.glyph}</span>
                    <div className="conncard__id">
                      <span className="conncard__name">{s.name}</span>
                      <span className="conncard__host">{s.host}</span>
                    </div>
                    {/* spoken as well as shown: "connecting…" is the one
                        state a reader cannot see coming */}
                    <span
                      className={"conn-live" + (on ? " is-on" : "") + (probing ? " is-busy" : "")}
                      role="status"
                      aria-live="polite"
                    >
                      <i />{probing ? "connecting…" : on ? (st.account ? "@" + st.account : "live") : "off"}
                    </span>
                    {/* The switch IS the connection. It does not flip on a
                        click and hope: it stays where it is while Atlas
                        actually calls the source, and settles only on what
                        the server reports back. A switch that moved first
                        would be claiming a connection nobody made.

                        On the hosted archive it flips this reader's own
                        preference instead — whether Atlas looks here during
                        their hunts — because a press that wrote to the
                        server would let one visitor switch the Met off for
                        everybody. Only a source needing a credential is
                        inert there, having nothing a preference could
                        stand in for. An unauthorised account source shows
                        no switch at all — its door is the button below. */}
                    {!needsAuth && (
                    <button
                      type="button"
                      className={"conncard__switch" + (on ? " on" : "") + (probing ? " is-busy" : "")}
                      role="switch"
                      aria-checked={on}
                      aria-busy={probing}
                      aria-disabled={probing || inert}
                      aria-label={switchTitle(s, on, st, hosted)}
                      title={switchTitle(s, on, st, hosted)}
                      disabled={inert}
                      onClick={() => (hosted ? mute(s.id, on) : act(s, on))}
                    />
                    )}
                  </div>

                  <p className="conncard__line">{s.line}</p>

                  <div className="conncard__reads">
                    {([["Data", s.metadata], ["Images", s.images], ["Keep", s.keep]] as const).map(([k, [g, note]]) => (
                      <span key={k} className={"conn-read is-" + g} title={note}>
                        <i aria-hidden="true">{MARK[g]}</i>{k}
                      </span>
                    ))}
                  </div>

                  {/* which env var is missing is the owner's business, not a
                      visitor's: hosted cards say where a thing runs instead */}
                  {!hosted && st && !st.ready && !on && (
                    <p className="conncard__missing">
                      Needs{" "}
                      {st.missing.map((v, i) => (
                        <span key={v}>{i > 0 && " and "}<code>{v}</code></span>
                      ))}
                    </p>
                  )}
                  {/* Say WHY there is no Connect button here, rather than
                      leaving a reader to wonder where it went. A public
                      archive has no visitor accounts, so a token would have
                      nowhere of its own to live. */}
                  {hosted && s.auth !== "none" && (
                    <p className="conncard__missing">
                      {s.auth === "oauth"
                        ? "Signing in to your account needs the local build — a public archive has nowhere of its own to keep your token."
                        : "Needs an API key, which lives in the local build’s .env.local."}
                    </p>
                  )}
                  {/* what the source said about itself when it answered */}
                  {on && st?.detail && <p className="conncard__detail">{st.detail}</p>}
                  {!on && st?.lastError && <p className="conncard__fail">{st.lastError}</p>}

                  <div className="conncard__foot">
                    {/* On the public archive nothing connects or disconnects:
                        the open sources are simply available, so the card
                        carries no switch at all and says where the act lives
                        rather than offering one whose answer is a 403. */}
                    {hosted ? (
                      <span className="conncard__where">
                        {inert ? "connects in the local runtime"
                          : on ? "searched in your hunts"
                          : "skipped in your hunts"}
                      </span>
                    ) : needsAuth ? (
                      /* The door to the account. It leaves for the provider,
                         so it says the provider's name and what comes back —
                         never a bare "Connect" that could mean anything. */
                      <button
                        type="button"
                        className="conn-cta"
                        disabled={probing}
                        onClick={() => act(s, false)}
                      >
                        <IconLink width={12} height={12} />
                        Connect {s.name}
                      </button>
                    ) : null}
                    <button
                      className={"conncard__more" + (open ? " is-open" : "")}
                      onClick={() => setOpenId((v) => (v === s.id ? null : s.id))}
                      aria-expanded={open}
                    >
                      {hosted ? "Details" : "Setup"}<IconCaret width={11} height={11} />
                    </button>
                  </div>

                  {open && (
                    <div className="conncard__setup">
                      <ol>{s.setup.map((t, i) => <li key={i}>{t}</li>)}</ol>
                      <a href={s.docs} target="_blank" rel="noreferrer noopener">Documentation ↗</a>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
