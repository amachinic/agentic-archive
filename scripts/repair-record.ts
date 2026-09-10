/*
  Make the brief and the keyterms one record again.

  The studio reads `ai_analysis`; the filter panel reads `image_tags`. They
  were written by the same pass and then drifted: scripts/verify-photographs
  reclassified the tag on 100 images and never rewrote the JSON, and the old
  facet gate blanked an off-list answer ("1810s") in the JSON while an
  earlier keyterm stood. Measured before this script: 70 works and 11 periods
  disagreeing, 9 works blank in the brief, 310 briefs showing a word the
  vocabulary had folded or dropped, 19 images carrying two artists.

  Three passes, all idempotent, the keyterms being the truth:
    1. BRIEF    every ai_analysis takes its work/carrier/period/materials/
                processes from the tags, and its subjects/style/mood are
                folded through canonical() so the brief only shows keyterms
    2. ARTISTS  an image with two artist links keeps the one that agrees
                with its artist column; the other is retired
    3. ORPHANS  tags no image carries are removed

    npx tsx scripts/repair-record.ts            # dry run
    npx tsx scripts/repair-record.ts --apply    # writes, after backing up
*/
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "../lib/db";
import { canonical } from "../lib/taxonomy";
import { filedFacets } from "../lib/vision";
import { recordEvent } from "../lib/events";

const APPLY = process.argv.includes("--apply");
const conn = db();

const normName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

function foldList(v: unknown, kind: string): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (typeof raw !== "string") continue;
    const can = canonical(raw);
    if (can && can.kind === kind && !out.includes(can.name)) out.push(can.name);
  }
  return out;
}

function main() {
  if (APPLY) {
    const backup = DB_PATH.replace(/\.db$/, "") + ".pre-repair.db";
    fs.copyFileSync(DB_PATH, backup);
    console.log("backup written: " + path.basename(backup) + "\n");
  }

  /* ---- 1. the brief takes the filed facets and the folded keyterms ---- */
  const rows = conn.prepare("SELECT id, ai_analysis FROM images WHERE ai_analysis IS NOT NULL").all() as { id: number; ai_analysis: string }[];
  let facetFixed = 0, listFixed = 0, unchanged = 0;
  const examples: string[] = [];
  const write = conn.prepare("UPDATE images SET ai_analysis = ? WHERE id = ?");
  for (const r of rows) {
    let a: Record<string, unknown>;
    try { a = JSON.parse(r.ai_analysis); } catch { continue; }
    const filed = filedFacets(r.id);
    const next = { ...a };
    let facetChange = false, listChange = false;
    for (const k of ["work", "carrier", "period"] as const) {
      if (filed[k] && a[k] !== filed[k]) { next[k] = filed[k]; facetChange = true; if (examples.length < 8) examples.push("#" + r.id + " " + k + ": " + JSON.stringify(a[k] ?? "") + " → " + filed[k]); }
    }
    for (const [k, kind] of [["materials", "material"], ["processes", "process"]] as const) {
      const have = Array.isArray(a[k]) ? (a[k] as string[]) : [];
      const want = filed[k];
      if (JSON.stringify([...have].sort()) !== JSON.stringify([...want].sort())) { next[k] = want; facetChange = true; }
    }
    for (const [k, kind] of [["subjects", "subject"], ["style", "style"], ["mood", "mood"]] as const) {
      const folded = foldList(a[k], kind);
      if (JSON.stringify(folded) !== JSON.stringify(a[k] ?? [])) { next[k] = folded; listChange = true; }
    }
    if (facetChange) facetFixed++;
    if (listChange) listFixed++;
    if (!facetChange && !listChange) { unchanged++; continue; }
    if (APPLY) write.run(JSON.stringify(next), r.id);
  }
  console.log("1. BRIEF    " + facetFixed + " briefs take their facets from the keyterms, " + listFixed + " have their lists folded, " + unchanged + " already agree");
  examples.forEach((e) => console.log("            " + e));

  /* ---- 2. one artist per image ---- */
  const doubled = conn.prepare(
    "SELECT it.image_id id, i.artist col, GROUP_CONCAT(t.id) tagIds, GROUP_CONCAT(t.name, '|') names " +
    "FROM image_tags it JOIN tags t ON t.id = it.tag_id JOIN images i ON i.id = it.image_id " +
    "WHERE t.kind = 'artist' GROUP BY it.image_id HAVING COUNT(*) > 1"
  ).all() as { id: number; col: string | null; tagIds: string; names: string }[];
  let retired = 0, undecided = 0;
  const unlink = conn.prepare("DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?");
  for (const d of doubled) {
    const ids = d.tagIds.split(",").map(Number), names = d.names.split("|");
    const col = d.col ? normName(d.col) : "";
    const keepIdx = names.findIndex((n) => normName(n) === col);
    if (keepIdx < 0) { undecided++; console.log("   ? #" + d.id + " carries " + names.join(" | ") + " and the column says " + JSON.stringify(d.col) + " — left alone"); continue; }
    names.forEach((n, i) => {
      if (i === keepIdx) return;
      retired++;
      console.log("   #" + d.id + "  retire “" + n + "”, keep “" + names[keepIdx] + "”");
      if (APPLY) { unlink.run(d.id, ids[i]); recordEvent("archivist", "reconcile-artist", { retired: n, kept: names[keepIdx] }, d.id); }
    });
  }
  console.log("2. ARTISTS  " + retired + " superseded links retired, " + undecided + " left for a person");

  /* ---- 3. orphans ---- */
  const orphans = conn.prepare(
    "SELECT t.id, t.name, t.kind FROM tags t LEFT JOIN image_tags it ON it.tag_id = t.id WHERE it.tag_id IS NULL"
  ).all() as { id: number; name: string; kind: string }[];
  for (const o of orphans) {
    console.log("   orphan " + o.name + " (" + o.kind + ")");
    if (APPLY) conn.prepare("DELETE FROM tags WHERE id = ?").run(o.id);
  }
  console.log("3. ORPHANS  " + orphans.length + " unused tags removed");

  /* ---- what the archive looks like afterwards ---- */
  const check = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  const multi = (kind: string) => check("SELECT COUNT(*) n FROM (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.kind = '" + kind + "' GROUP BY it.image_id HAVING COUNT(*) > 1)");
  console.log("\nimages with two works / carriers / periods / artists: " + [multi("work"), multi("carrier"), multi("period"), multi("artist")].join(" / "));
  if (APPLY) recordEvent("archivist", "repair-record", { briefs: facetFixed + listFixed, artistsRetired: retired, orphans: orphans.length });
  else console.log("\nDRY RUN. Nothing was written. Re-run with --apply to commit.");
}

main();
