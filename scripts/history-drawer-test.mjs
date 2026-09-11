/*
  What the panel's memory PROMISES, checked by driving the real panel.

  One open chat, the rest in a drawer from the panel's left edge. The
  promises are the ones a person would notice breaking: the open chat is
  the one with the dot; New keeps the last one; picking a row brings that
  chat back with its title; a reload forgets nothing; remove removes; the
  sliver and Escape close. None of it needs a model -- the "/" commands
  make conversations without one.

  Needs the dev server up:  npm run dev
    node scripts/history-drawer-test.mjs
*/
import { chromium } from "playwright";

const BASE = "http://localhost:4400";
const res = [];
const ok = (n, pass, d) => { res.push(pass); console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        " + d : "")); };

const ping = await fetch(BASE).catch(() => null);
if (!ping || !ping.ok) { console.error("nothing serving " + BASE + " -- start `npm run dev` first"); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("        [pageerror] " + e.message));
await page.addInitScript(() => { try { sessionStorage.setItem("atlas-booted", "1"); } catch {} });
const ready = async () => {
  await page.waitForFunction(() => !!document.querySelector(".graph-stage canvas") && !!document.querySelector(".chatdock .graph-ci__text"), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
};
const say = async (text) => { await page.fill(".graph-ci__text", text); await page.keyboard.press("Enter"); await page.waitForTimeout(900); };
const rows = () => page.locator(".chat-hist__row:not(.chat-hist__new)");
const title = async () => (await page.locator(".graph-topic").textContent()).trim();
const drawerOpen = () => page.evaluate(() => document.querySelector(".chat-hist")?.classList.contains("is-open"));

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.removeItem("atlas-conversations"); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await ready();

console.log("═══ the head");
ok("Copy log is gone", (await page.locator(".chathead button:has-text('Copy log')").count()) === 0);
ok("the History pill sits left of the collapse chevron, with no chevron of its own",
   await page.evaluate(() => { const acts = document.querySelector(".chathead .filtersheet__actions"); const kids = Array.from(acts.children); const i = kids.findIndex((k) => k.classList.contains("histpill")); return i >= 0 && kids[i + 1]?.classList.contains("chathead__toggle") && !kids[i].querySelector(".chathead__chevron"); }));
ok("a fresh panel has nothing kept", (await (async () => { await page.click(".histpill"); await page.waitForTimeout(500); return rows().count(); })()) === 0, "");
ok("the drawer is out", await drawerOpen());
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
ok("Escape closes it", !(await drawerOpen()));

console.log("\n═══ one conversation, then New");
await say("/sort");
ok("the first ask names the chat", (await title()).toLowerCase().includes("sort the canvas"), await title());
ok("New is offered, Clear is not", (await page.locator(".chathead button:has-text('New')").count()) === 1 && (await page.locator(".chathead button:has-text('Clear')").count()) === 0);
await page.click(".histpill"); await page.waitForTimeout(500);
ok("the list holds the open chat, with the dot", (await rows().count()) === 1 && (await page.locator(".chat-hist__row.is-on .chat-hist__dot").count()) === 1, "rows " + (await rows().count()));
ok("the sliver closes it", await (async () => { await page.click(".chat-hist__scrim"); await page.waitForTimeout(500); return !(await drawerOpen()); })());
await page.click(".histpill"); await page.waitForTimeout(500);
ok("New conversation is the grey pill on the bar, with the X at the far right",
   await page.evaluate(() => { const bar = document.querySelector(".chat-hist__bar"); if (!bar) return false; const n = bar.querySelector(".chat-hist__new"), x = bar.querySelector(".chat-hist__close"); if (!n || !x) return false; const nb = n.getBoundingClientRect(), xb = x.getBoundingClientRect(), bb = bar.getBoundingClientRect(); return n.classList.contains("closebtn") && getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)" && xb.left > nb.right && bb.right - xb.right < 30; }));
ok("the X closes it", await (async () => { await page.click(".chat-hist__close"); await page.waitForTimeout(500); return !(await drawerOpen()); })());
await page.click(".chathead button:has-text('New')"); await page.waitForTimeout(1600);
ok("New empties the panel", (await title()) === "Agent" && (await page.locator(".agent-home").count()) === 1, await title());
await page.click(".histpill"); await page.waitForTimeout(500);
ok("…and the last chat stays in the list, no dot on it (the new one is empty, so it is not listed)", (await rows().count()) === 1 && (await page.locator(".chat-hist__row.is-on").count()) === 0);
await page.keyboard.press("Escape"); await page.waitForTimeout(400);

console.log("\n═══ a second conversation, and picking the first back");
await say("/ledger");
ok("/ledger is the renamed timeline command", (await page.locator(".agent-tl").count()) === 1 && /Ledger · this session/.test(await page.locator(".agent-tl").textContent()));
await page.click(".histpill"); await page.waitForTimeout(500);
ok("two chats listed, newest first, the dot on the open one", (await rows().count()) === 2 && (await rows().first().locator(".chat-hist__dot").count()) === 1, (await rows().allTextContents()).join(" | "));
const firstTopic = (await rows().nth(1).locator(".chat-hist__t").textContent()).trim();
await rows().nth(1).click(); await page.waitForTimeout(900);
ok("picking a row closes the drawer and brings that chat back, title and all", !(await drawerOpen()) && (await title()).toLowerCase() === firstTopic.toLowerCase() && (await page.locator(".agent-ctas").count()) >= 1, "title now “" + (await title()) + "”");
await page.click(".histpill"); await page.waitForTimeout(500);
ok("the dot moved with the pick", (await page.locator(".chat-hist__row.is-on .chat-hist__t").textContent()).trim().toLowerCase() === firstTopic.toLowerCase());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);

console.log("\n═══ typing continues the open chat and lifts it");
await say("/ledger");
await page.click(".histpill"); await page.waitForTimeout(500);
ok("the continued chat is first now", (await rows().first().locator(".chat-hist__t").textContent()).trim().toLowerCase() === firstTopic.toLowerCase() && (await rows().first().locator(".chat-hist__w").textContent()).trim() === "now", (await rows().allTextContents()).join(" | "));
await page.keyboard.press("Escape"); await page.waitForTimeout(300);

console.log("\n═══ a reload forgets nothing");
await page.reload({ waitUntil: "domcontentloaded" });
await ready();
ok("the panel starts fresh", (await title()) === "Agent");
await page.click(".histpill"); await page.waitForTimeout(600);
ok("both chats are still in the list", (await rows().count()) === 2, (await rows().allTextContents()).join(" | "));
await rows().first().click(); await page.waitForTimeout(900);
ok("a kept chat opens after a reload with its thread", (await page.locator(".agent-ctas").count()) >= 1 && (await title()).toLowerCase() === firstTopic.toLowerCase());

console.log("\n═══ remove");
await page.click(".histpill"); await page.waitForTimeout(500);
await rows().nth(1).hover();
await rows().nth(1).locator(".chat-hist__x").click(); await page.waitForTimeout(500);
ok("× removes a chat from the list", (await rows().count()) === 1);
ok("the footer counts", /1 conversation/.test(await page.locator(".chat-hist__foot").textContent()));
await page.keyboard.press("Escape");

await browser.close();
const pass = res.filter(Boolean).length;
console.log("\n═══ " + pass + "/" + res.length + " PASS");
process.exit(pass === res.length ? 0 : 1);
