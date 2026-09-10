/*
  What the Archivist's RECORD promises, checked against the database it wrote.

  None of this is visible to a type-checker: a brief that says "photograph"
  over a keyterm that says "record sleeve" renders fine in both places and
  is simply two answers to one question. Every assertion here is one the
  archive failed on 2026-09-10 (see the Archivist QA), so a regression is a
  return to a measured state, not a hypothetical.

  Read-only. Runs against the live atlas.db in a second or two:
    npx tsx scripts/archivist-audit.ts
*/
import { db } from "../lib/db";
import { canonical, KIND_OF } from "../lib/taxonomy";
import { filedFacets } from "../lib/vision";

const c = db();
const res: boolean[] = [];
const ok = (n: string, pass: boolean, d?: string) => { res.push(pass); console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        " + d : "")); };
const one = (sql: string) => (c.prepare(sql).get() as { n: number }).n;

console.log("═══ every image carries the archival facets, once");
for (const kind of ["work", "carrier", "period"]) {
  const none = one("SELECT COUNT(*) n FROM images i WHERE NOT EXISTS (SELECT 1 FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE it.image_id=i.id AND t.kind='" + kind + "')");
  const multi = one("SELECT COUNT(*) n FROM (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.kind='" + kind + "' GROUP BY it.image_id HAVING COUNT(*) > 1)");
  ok(kind + ": exactly one per image", none === 0 && multi === 0, "none " + none + " · more than one " + multi);
}
ok("no image carries two artists", one("SELECT COUNT(*) n FROM (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.kind='artist' GROUP BY it.image_id HAVING COUNT(*) > 1)") === 0);

console.log("\n═══ the vocabulary is the vocabulary");
const tags = c.prepare("SELECT t.id, t.name, t.kind, COUNT(it.image_id) n FROM tags t LEFT JOIN image_tags it ON it.tag_id=t.id GROUP BY t.id").all() as { id: number; name: string; kind: string; n: number }[];
const wrongKind = tags.filter((t) => KIND_OF[t.name] && KIND_OF[t.name] !== t.kind);
ok("every taxonomy word sits on its canonical kind", wrongKind.length === 0, wrongKind.map((t) => t.name + ":" + t.kind).join(", "));
const retired = tags.filter((t) => t.kind === "medium");
ok("the retired 'medium' kind is gone", retired.length === 0, retired.map((t) => t.name).join(", "));
const orphans = tags.filter((t) => t.n === 0);
ok("no tag sits on zero images", orphans.length === 0, orphans.map((t) => t.name + ":" + t.kind).join(", "));
const foreign = tags.filter((t) => !["artist", "color", "tag", "format"].includes(t.kind) && !KIND_OF[t.name]);
ok("every ai keyterm outside artist/color/manual is a taxonomy word", foreign.length === 0, foreign.map((t) => t.name + ":" + t.kind).join(", "));

console.log("\n═══ the brief and the keyterms are one record");
const rows = c.prepare("SELECT id, ai_analysis FROM images WHERE ai_analysis IS NOT NULL").all() as { id: number; ai_analysis: string }[];
let facetDisagree = 0, listDisagree = 0, blank = 0;
const ex: string[] = [];
for (const r of rows) {
  let a: Record<string, unknown>;
  try { a = JSON.parse(r.ai_analysis); } catch { continue; }
  const filed = filedFacets(r.id);
  for (const k of ["work", "carrier", "period"] as const) {
    if (!a[k]) blank++;
    else if (a[k] !== filed[k]) { facetDisagree++; if (ex.length < 6) ex.push("#" + r.id + " " + k + " brief " + JSON.stringify(a[k]) + " tag " + JSON.stringify(filed[k])); }
  }
  for (const [k, kind] of [["subjects", "subject"], ["style", "style"], ["mood", "mood"]] as const) {
    for (const w of Array.isArray(a[k]) ? (a[k] as unknown[]) : []) {
      const can = typeof w === "string" ? canonical(w) : null;
      if (!can || can.kind !== kind || can.name !== w) { listDisagree++; if (ex.length < 6) ex.push("#" + r.id + " " + k + " shows " + JSON.stringify(w)); break; }
    }
  }
}
ok("no brief names a work/carrier/period the image does not carry", facetDisagree === 0, facetDisagree + " disagree · " + ex.join(" · "));
ok("no brief leaves a facet blank", blank === 0, blank + " blank");
ok("every word in a brief's lists is the keyterm it was filed as", listDisagree === 0, listDisagree + " briefs show a folded or dropped word · " + ex.join(" · "));

console.log("\n═══ provenance and the ledger");
const models = c.prepare("SELECT ai_model, COUNT(*) n FROM images WHERE ai_at IS NOT NULL GROUP BY ai_model").all() as { ai_model: string | null; n: number }[];
ok("every catalogued image names the model that catalogued it", models.every((m) => !!m.ai_model && !/^quick-failed/.test(m.ai_model)), models.map((m) => m.ai_model + " " + m.n).join(" · "));
ok("a failed quick pass never counts as done", one("SELECT COUNT(*) n FROM images WHERE ai_at IS NOT NULL AND ai_model LIKE 'quick-failed%'") === 0);
const catalogued = one("SELECT COUNT(*) n FROM events WHERE agent='archivist' AND action IN ('analyze','quick-tag','handtag')");
const since = one("SELECT COUNT(*) n FROM events WHERE agent='archivist' AND action='repair-record'");
ok("the ledger has heard from the Archivist", catalogued > 0 || since > 0, "catalogue events " + catalogued + " · repairs " + since + (catalogued === 0 && since === 0 ? "  <- run the repair, or catalogue one image" : ""));

const pass = res.filter(Boolean).length;
console.log("\n═══ " + pass + "/" + res.length + " PASS");
process.exit(pass === res.length ? 0 : 1);
