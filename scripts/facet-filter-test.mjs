/*
  What the filter panel PROMISES, against the field it actually forms.

  Checked terms are OR within a facet and AND across them. That is one
  sentence, and getting it wrong is invisible: every() over the flat list
  type-checks, renders, throws nothing, and quietly empties the canvas the
  moment a second value of a single-valued facet is ticked. Period, work and
  carrier hold exactly one value per image, so "1930s AND 1940s" is not a
  narrow result, it is an impossible one -- 13 and 13 giving 0 while the counts
  printed beside the terms still say 13 and 13.

  Nothing here hardcodes a count. The test reads the numbers the panel is
  showing and asserts the RELATIONSHIP, so it keeps meaning something as the
  library grows:

    · two values of a single-valued facet  -> exactly the sum
    · two values of a multi-valued facet   -> at least the larger, at most the sum
    · a value from a second facet          -> no more than either alone

  Needs the dev server up:  npm run dev
    node scripts/facet-filter-test.mjs
*/
import { chromium } from "playwright";

const BASE = "http://localhost:4400";
const res = [];
const ok = (n, pass, d) => { res.push(pass); console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        " + d : "")); };

const ping = await fetch(BASE).catch(() => null);
if (!ping || !ping.ok) {
  console.error("nothing serving " + BASE + " -- start `npm run dev` first");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 }, colorScheme: "dark" })).newPage();
await page.addInitScript(() => { try { sessionStorage.setItem("atlas-booted", "1"); } catch (e) {} });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const pill = document.querySelector(".topbar .pill");
  return !!document.querySelector(".graph-stage canvas") && !!pill && parseInt(pill.textContent.replace(/[^0-9]/g, ""), 10) > 0;
}, null, { timeout: 90000 });
await page.waitForTimeout(4000);

/* the pill reports the same pool the field forms from, which is the whole
   point of reading it rather than counting nodes */
const pool = () => page.evaluate(() => parseInt(document.querySelector(".topbar .pill").textContent.replace(/[^0-9]/g, ""), 10));
const clickText = async (re) => {
  const hit = await page.evaluate((src) => {
    const rx = new RegExp(src, "i");
    const b = Array.from(document.querySelectorAll("button")).find((x) => rx.test(x.textContent.trim()));
    if (b) { b.click(); return true; }
    return false;
  }, re.source);
  await page.waitForTimeout(700);
  return hit;
};
/* tick a term by name and hand back the count the panel prints beside it */
const tick = async (name) => {
  const n = await page.evaluate((want) => {
    const row = Array.from(document.querySelectorAll(".frow"))
      .find((r) => (r.querySelector(".frow__name")?.textContent || "").trim().toLowerCase() === want.toLowerCase());
    if (!row) return null;
    row.click();
    return Number(row.querySelector(".frow__n")?.textContent || 0);
  }, name);
  await page.waitForTimeout(1100);
  return n;
};
/* the first two terms of the facet the panel is currently showing */
const twoTerms = () => page.evaluate(() =>
  Array.from(document.querySelectorAll(".frow")).slice(0, 2).map((r) => ({
    name: (r.querySelector(".frow__name")?.textContent || "").trim(),
    count: Number(r.querySelector(".frow__n")?.textContent || 0),
  })));

const reload = async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const pill = document.querySelector(".topbar .pill");
    return !!document.querySelector(".graph-stage canvas") && !!pill && parseInt(pill.textContent.replace(/[^0-9]/g, ""), 10) > 0;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(3500);
  await clickText(/^filters/);
};

await clickText(/^filters/);
const baseline = await pool();
console.log(`\n═══ pool with nothing ticked: ${baseline}`);

console.log("\n═══ two values of a SINGLE-valued facet are alternatives");
{
  await clickText(/^period/);
  const [a, b] = await twoTerms();
  if (!a || !b) ok("period has two terms to try", false, "found fewer than two rows");
  else {
    const ca = await tick(a.name); const afterA = await pool();
    const cb = await tick(b.name); const afterBoth = await pool();
    ok(`one value forms a field the size of its own count`, afterA === ca,
       `${a.name} says ${ca}, field is ${afterA}`);
    ok(`two values give the sum, not nothing`, afterBoth === ca + cb,
       `${a.name} ${ca} + ${b.name} ${cb} = ${ca + cb}, field is ${afterBoth}` +
       (afterBoth === 0 ? "  <- this is the AND bug: an image cannot be both" : ""));
  }
}

console.log("\n═══ two values of a MULTI-valued facet may overlap, and still union");
await reload();
{
  await clickText(/^(style|subject|mood|material|process)/);
  const [a, b] = await twoTerms();
  if (!a || !b) ok("a multi-valued facet has two terms to try", false, "found fewer than two rows");
  else {
    const ca = await tick(a.name);
    const cb = await tick(b.name); const both = await pool();
    ok("the union is at least the larger of the two", both >= Math.max(ca, cb),
       `${a.name} ${ca}, ${b.name} ${cb}, field ${both}`);
    ok("and no more than their sum", both <= ca + cb,
       `field ${both} against a ceiling of ${ca + cb}${both < ca + cb ? " (they overlap, which is allowed)" : ""}`);
  }
}

console.log("\n═══ across facets it still narrows");
await reload();
{
  await clickText(/^period/);
  const [a] = await twoTerms();
  const ca = await tick(a.name); const afterA = await pool();
  await clickText(/back|all filters|←/);
  await clickText(/^(work|carrier|style|subject)/);
  const [w] = await twoTerms();
  const cw = await tick(w.name); const cross = await pool();
  ok("a second facet can only ever take images away", cross <= Math.min(afterA, cw),
     `${a.name} alone ${afterA}, ${w.name} alone says ${cw}, together ${cross}`);
}

await browser.close();
const pass = res.filter(Boolean).length;
console.log(`\n═══ ${pass}/${res.length} PASS`);
process.exit(pass === res.length ? 0 : 1);
