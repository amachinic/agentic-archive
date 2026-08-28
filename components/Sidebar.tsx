"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import type { CollectionNode } from "@/lib/queries";
import { AtlasMark, IconNetwork, IconWaterfall, IconFolder, IconCaret, IconPlus, IconSparkle, IconTrash, IconAgent, IconSave, IconLink } from "./icons";
import { useDialogs } from "./DialogProvider";
import { write } from "@/lib/write";
import ThemeToggle from "./ThemeToggle";

type Stats = { images: number; analyzed: number; pairs: number; tags: number; keep: number; reject: number; bytes: number };

const VIEWS = [
  { href: "/", label: "Network", icon: IconNetwork },
  { href: "/gallery", label: "Gallery", icon: IconWaterfall },
  { href: "/analyze", label: "Analyze", icon: IconSparkle },
];

export default function Sidebar({
  tree, stats, hostedDemo = false,
}: {
  tree: CollectionNode[];
  stats: Stats;
  hostedDemo?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const dialogs = useDialogs();
  const activeCollection = params.get("c") ? Number(params.get("c")) : null;
  const activeTag = params.get("tag");

  /* ---- folders that have just arrived ----
     A folder the agent files lands here through router.refresh(), and a row
     that simply exists on the next paint reads as a redraw rather than as
     something happening: the sidebar looks the same, one line longer. So a
     folder that was not in the last tree plays itself in once, sliding down
     from behind the row above it while the list opens to make room.

     Only arrivals animate. The set the sidebar mounts with is recorded
     without playing, or every folder would slide in on each page load.

     A layout effect, not an effect: the row is in the DOM before either
     runs, and an ordinary effect fires AFTER the browser has painted it, so
     the folder appeared at full height for a frame and then collapsed to
     animate back. Measured, that flash was 60ms of finished row before the
     open began. useLayoutEffect lands the class in the same paint. */
  /* Folders the agent has just written, shown before the server render
     catches up. router.refresh() needs about three seconds here because it
     rebuilds the whole page, the 925-node graph included, and a folder that
     lands three seconds after Atlas says it is filed reads as the app
     lagging. These come straight from the write's own response and are
     dropped again the moment the real tree carries them. */
  const [pending, setPending] = useState<CollectionNode[]>([]);
  useEffect(() => {
    const onCreated = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: number; name: string; count: number };
      if (!d || typeof d.id !== "number") return;
      setPending((p) => (p.some((x) => x.id === d.id) ? p : [...p, {
        id: d.id, name: d.name, parent_id: null, note: null, count: d.count ?? 0, children: [],
      }]));
    };
    window.addEventListener("atlas:folder-created", onCreated);
    return () => window.removeEventListener("atlas:folder-created", onCreated);
  }, []);

  const serverIds = useMemo(() => {
    const have = new Set<number>();
    const walk = (ns: CollectionNode[]) => { for (const n of ns) { have.add(n.id); walk(n.children); } };
    walk(tree);
    return have;
  }, [tree]);

  const shownTree = useMemo(() => {
    const extra = pending.filter((p) => !serverIds.has(p.id));
    return extra.length ? [...tree, ...extra] : tree;
  }, [tree, pending, serverIds]);

  /* let them go once the server render has them */
  useEffect(() => {
    if (pending.some((p) => serverIds.has(p.id))) {
      setPending((p) => p.filter((x) => !serverIds.has(x.id)));
    }
  }, [serverIds, pending]);

  const known = useRef<Set<number> | null>(null);
  /* The height to open to, read off a row already on screen. The animation
     needs a real number: a grid track of 0fr still leaves the row as tall
     as its own padding, so the list jumped 14px before it started moving. */
  const [arrival, setArrival] = useState<{ ids: Set<number>; h: number }>(() => ({ ids: new Set(), h: 0 }));
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  useLayoutEffect(() => {
    const ids = new Set<number>();
    const walk = (nodes: CollectionNode[]) => {
      for (const n of nodes) { ids.add(n.id); walk(n.children); }
    };
    walk(shownTree);

    if (known.current === null) { known.current = ids; return; }
    const fresh = [...ids].filter((id) => !known.current!.has(id));
    known.current = ids;
    if (!fresh.length) return;

    const row = document.querySelector(".tree-row");
    const h = row ? Math.round(row.getBoundingClientRect().height) : 0;
    setArrival({ ids: new Set(fresh), h });
    /* Clear the class once the animation is spent. The timer lives in a ref
       rather than in this effect's cleanup: tree is a fresh array on every
       render, so a cleanup here would cancel the pending clear the moment
       anything else re-rendered, and the class would stay on for good. */
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setArrival({ ids: new Set(), h: 0 }), 1100);
  }, [shownTree]);

  /* ---- Resizable / collapsible sidebar ----
     The right edge is a handle: drag to stretch (200-420px), click to
     collapse into a 56px icon rail. Dragging a collapsed rail outward
     re-expands it. Width and state persist. */
  const [collapsed, setCollapsed] = useState(false);
  const [sbWidth, setSbWidth] = useState(244);
  const dragRef = useRef<{ startX: number; startW: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("atlas-sbw"));
      if (w) setSbWidth(Math.min(420, Math.max(200, w)));
      if (localStorage.getItem("atlas-sbc") === "1") setCollapsed(true);
    } catch { /* first run */ }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", collapsed ? "56px" : sbWidth + "px");
    try {
      localStorage.setItem("atlas-sbw", String(sbWidth));
      localStorage.setItem("atlas-sbc", collapsed ? "1" : "0");
    } catch { /* blocked storage */ }
  }, [collapsed, sbWidth]);

  function onHandleDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: collapsed ? 56 : sbWidth, moved: false };
    document.body.classList.add("sb-resizing");
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    const w = Math.round(d.startW + dx);
    if (w < 140) setCollapsed(true);
    else { setCollapsed(false); setSbWidth(Math.min(420, Math.max(200, w))); }
  }
  function onHandleUp() {
    const d = dragRef.current;
    dragRef.current = null;
    document.body.classList.remove("sb-resizing");
    if (d && !d.moved) setCollapsed((c) => !c); // plain click toggles
  }

  async function deleteCollection(node: CollectionNode) {
    const ok = await dialogs.confirm({
      title: "Remove “" + node.name + "”?",
      message:
        (node.count ? "Its " + node.count + " image" + (node.count === 1 ? " stays" : "s stay") + " in the library. " : "") +
        (node.children.length ? "Sub-folders inside it are removed too. " : "") +
        "Only the folder goes away.",
      confirmLabel: "Remove folder",
      danger: true,
    });
    if (!ok) return;
    const r = await write("/api/collections?id=" + node.id, { method: "DELETE" });
    if (!r.ok) {
      await dialogs.alert({ title: "Folder not removed", message: r.message });
      return;
    }
    // if the removed folder was open, fall back to the whole library
    if (activeCollection === node.id) router.push("/library");
    else router.refresh();
  }

  async function newCollection(parentId: number | null) {
    const name = await dialogs.prompt({
      title: parentId ? "New sub-folder" : "New folder",
      message: parentId ? "Nested inside the current folder." : "Folders are virtual: an image can live in many at once.",
      label: "Name",
      placeholder: "e.g. Typography references",
      confirmLabel: "Create",
    });
    if (!name) return;
    const r = await write("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    if (!r.ok) {
      await dialogs.alert({ title: parentId ? "Sub-folder not created" : "Folder not created", message: r.message });
      return;
    }
    router.refresh();
  }

  return (
    <aside className={"sidebar" + (collapsed ? " is-collapsed" : "")}>
      <div
        className="sidebar__handle"
        role="separator"
        aria-label="Sidebar edge. Drag to resize, click to collapse."
        title="Drag to resize · click to collapse"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
      <div className="sidebar__brand">
        <Link href="/" className="sidebar__mark">
          <AtlasMark className="sidebar__mark-logo" />
          Atlas
        </Link>
        {hostedDemo && <span className="sidebar__demo" title="Hosted archive. Archive changes and model calls are disabled.">read only</span>}
      </div>

      <div className="sidebar__scroll">
        <nav className="nav-group" aria-label="Library">
          <div className="nav-group__title"><span className="mono-label">Library</span></div>
          {VIEWS.map((v) => {
            const active = pathname === v.href && !activeCollection && !activeTag;
            return (
              <Link
                key={v.href}
                href={v.href}
                className={"nav-item" + (active ? " is-active" : "")}
                title={v.label}
                aria-label={v.label}
                aria-current={active ? "page" : undefined}
              >
                <v.icon className="nav-item__icon" />
                <span className="nav-item__label">{v.label}</span>
              </Link>
            );
          })}
        </nav>

        <nav className="nav-group" aria-label="Folders">
          <div className="nav-group__title">
            <span className="mono-label">Folders</span>
            <button className="btn is-ghost btn--icon" style={{ height: 20, width: 20 }} onClick={() => newCollection(null)} title="New folder" aria-label="New folder">
              <IconPlus width={12} height={12} />
            </button>
          </div>
          {shownTree.map((node) => (
            <TreeItem key={node.id} node={node} depth={0} activeId={activeCollection} arrival={arrival} onNewChild={newCollection} onDelete={deleteCollection} />
          ))}
          {shownTree.length === 0 && (
            <div style={{ padding: "4px 8px", fontSize: "var(--font-body-xs)", color: "var(--text-muted)" }}>
              No folders yet
            </div>
          )}
        </nav>

        <nav className="nav-group" aria-label="Agents">
          <div className="nav-group__title"><span className="mono-label">Agents</span></div>
          <Link
            href="/agents"
            className={"nav-item" + (pathname === "/agents" ? " is-active" : "")}
            title="Agent settings"
            aria-label="Agent settings"
            aria-current={pathname === "/agents" ? "page" : undefined}
          >
            <IconAgent className="nav-item__icon" />
            <span className="nav-item__label">Settings</span>
          </Link>
          <Link
            href="/agents/connections"
            className={"nav-item" + (pathname === "/agents/connections" ? " is-active" : "")}
            title="Sources Atlas may look at"
            aria-label="Connections"
            aria-current={pathname === "/agents/connections" ? "page" : undefined}
          >
            <IconLink className="nav-item__icon" />
            <span className="nav-item__label">Connections</span>
          </Link>
        </nav>
      </div>

      {/* mobile only: theme toggle rides the top bar's right end */}
      <span className="sidebar__mtoggle"><ThemeToggle /></span>

      {/* stats live pinned to the sidebar's bottom edge, outside the scroll */}
      <div className="sidebar__foot">
        <div className="nav-group" aria-label="Database">
          <div className="nav-group__title"><span className="mono-label">Database</span></div>
          <div className="stat-card">
            <StatRow label="analyzed" value={stats.analyzed + " / " + stats.images} />
            <StatRow label="connections" value={String(stats.pairs)} />
            <StatRow label="size" value={(stats.bytes / 1e9).toFixed(2) + " GB"} />
          </div>
          <DedupeButton />
        </div>
      </div>
    </aside>
  );
}

function DedupeButton() {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const probe = await fetch("/api/dedupe");
      const dry = await probe.json().catch(() => ({}));
      if (!probe.ok) {
        await dialogs.alert({ title: "Cannot scan for duplicates", message: typeof dry.error === "string" ? dry.error[0].toUpperCase() + dry.error.slice(1) : "That did not go through (" + probe.status + ")." });
        return;
      }
      if (!dry.duplicates) {
        await dialogs.alert({ title: "No duplicates", message: "The library is clean." });
        return;
      }
      const ok = await dialogs.confirm({
        title: "Remove " + dry.duplicates + " duplicate cop" + (dry.duplicates === 1 ? "y" : "ies") + "?",
        message:
          "Found across " + dry.groups + " group" + (dry.groups === 1 ? "" : "s") +
          ". The highest-resolution copy of each survives; the rest are removed from the managed library. Your source originals are untouched.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      const done = await write<{ removed: number }>("/api/dedupe", { method: "POST" });
      if (!done.ok) {
        await dialogs.alert({ title: "Duplicates not removed", message: done.message });
        return;
      }
      const r = done.data;
      await dialogs.alert({ title: "Duplicates removed", message: r.removed + " cop" + (r.removed === 1 ? "y" : "ies") + " removed from the library." });
      router.refresh();
    } catch {
      await dialogs.alert({ title: "Dedupe failed", message: "Something went wrong. Check the server log." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn is-outline" style={{ width: "100%" }} onClick={run} disabled={busy}>
      {busy ? <span className="spin" /> : <IconTrash width={14} height={14} />}
      {busy ? "Scanning" : "Remove duplicates"}
    </button>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px var(--space-1)" }}>
      <span className="mono-xs">{label}</span>
      <span className="mono-xs" style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function TreeItem({
  node, depth, activeId, arrival, onNewChild, onDelete,
}: {
  node: CollectionNode; depth: number; activeId: number | null;
  arrival: { ids: Set<number>; h: number };
  onNewChild: (parentId: number) => void;
  onDelete: (node: CollectionNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = node.children.length > 0;
  const router = useRouter();

  return (
    <>
      <div
        className={"tree-row" + (arrival.ids.has(node.id) ? " is-arriving" : "")}
        style={{
          ["--depth" as string]: depth,
          ...(arrival.ids.has(node.id) ? { ["--arrive-h" as string]: arrival.h + "px" } : {}),
        }}
      >
        <Link href={"/library?c=" + node.id} className={"nav-item" + (activeId === node.id ? " is-active" : "")}>
          {hasKids ? (
            <button
              className={"tree-caret" + (open ? " is-open" : "")}
              onClick={(e) => { e.preventDefault(); setOpen(!open); }}
              aria-label={open ? "Collapse" : "Expand"}
            >
              <IconCaret width={11} height={11} />
            </button>
          ) : (
            <IconFolder className="nav-item__icon" />
          )}
          <span className="nav-item__label">{node.name}</span>
          <span className="nav-item__count">{node.count}</span>
          <span className="tree-actions">
            <button
              className="tree-caret is-save"
              title="Save… the Media Manager asks where it should live"
              aria-label={"Save " + node.name}
              onClick={(e) => { e.preventDefault(); router.push("/?save=" + node.id); }}
            >
              <IconSave width={11} height={11} />
            </button>
            <button
              className="tree-caret is-add"
              title="New sub-folder"
              aria-label={"New sub-folder in " + node.name}
              onClick={(e) => { e.preventDefault(); onNewChild(node.id); }}
            >
              <IconPlus width={11} height={11} />
            </button>
            <button
              className="tree-caret is-danger"
              title="Remove folder"
              aria-label={"Remove folder " + node.name}
              onClick={(e) => { e.preventDefault(); onDelete(node); }}
            >
              <IconTrash width={11} height={11} />
            </button>
          </span>
        </Link>
      </div>
      {open && node.children.map((c) => (
        <TreeItem key={c.id} node={c} depth={depth + 1} activeId={activeId} arrival={arrival} onNewChild={onNewChild} onDelete={onDelete} />
      ))}
    </>
  );
}
