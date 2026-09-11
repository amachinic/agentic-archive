/*
  What the panel's memory PROMISES, checked by driving the real panel.

  One open chat, the rest in a sheet that rises over the chat area. The
  promises are the ones a person would notice breaking: the open chat is
  the one with the dot; New keeps the last one; picking a row brings that
  chat back with its title; a reload forgets nothing; remove removes; the X
  and Escape close. None of it needs a model -- the "/" commands
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
ok("the GitHub mark sits left of the theme switch and points at the repo",
   await page.evaluate(() => { const a = document.querySelector(".topbar .gh-link"), t = document.querySelector(".topbar .theme-switch"); if (!a || !t) return false; const ab = a.getBoundingClientRect(), tb = t.getBoundingClientRect(); return a.href === "https://github.com/amachinic/agentic-archive" && a.target === "_blank" && ab.right <= tb.left && Math.abs((ab.top + ab.height / 2) - (tb.top + tb.height / 2)) < 3; }));
ok("the offers have air above the field", await page.evaluate(() => { const s = document.querySelector(".agent-offers").getBoundingClientRect(), c = document.querySelector(".chatdock .graph-ci").getBoundingClientRect(); return c.top - s.bottom >= 16 && c.top - s.bottom <= 24; }));
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
ok("the opener says hi and stays as the first turn, the command hint on its own line, no offers in it",
   (await page.locator(".agent-home__say").count()) === 2 && /^Hi, I’m Atlas\./.test((await page.locator(".agent-home__say").first().textContent()).trim()) && /^Type “\/” to see every command\.$/.test((await page.locator(".agent-home__cmd").textContent()).trim()) && (await page.locator(".agent-home .agent-cta").count()) === 0
   && await page.evaluate(() => { const a = document.querySelector(".agent-home__say"), c = document.querySelector(".agent-home__cmd"); return c.getBoundingClientRect().top - a.getBoundingClientRect().bottom >= 4; }),
   (await page.locator(".agent-home__cmd").textContent()).slice(0, 60));
ok("the offers are one row above the composer, five of them, none wrapping",
   await page.evaluate(() => { const s = document.querySelector(".agent-offers"), ci = document.querySelector(".chatdock .graph-ci"); if (!s || !ci) return false; const b = s.getBoundingClientRect(), c = ci.getBoundingClientRect(); const tops = Array.from(s.querySelectorAll(".agent-cta")).map((x) => Math.round(x.getBoundingClientRect().top)); return b.bottom <= c.top + 1 && c.top - b.bottom < 24 && tops.length === 5 && new Set(tops).size === 1; }));
ok("the row runs past the panel, so its right edge fades; scrolled to the end, the left edge fades instead",
   await page.evaluate(async () => { const s = document.querySelector(".agent-offers"), t = s.querySelector(".agent-offers__track"); const a = s.classList.contains("has-right") && !s.classList.contains("has-left"); t.scrollLeft = t.scrollWidth; await new Promise((r) => setTimeout(r, 120)); const b = s.classList.contains("has-left") && !s.classList.contains("has-right"); t.scrollLeft = 0; return a && b; }));
ok("New is offered, Clear is not", (await page.locator(".chathead button:has-text('New')").count()) === 1 && (await page.locator(".chathead button:has-text('Clear')").count()) === 0);
await page.click(".histpill"); await page.waitForTimeout(500);
ok("the list holds the open chat, with the dot", (await rows().count()) === 1 && (await page.locator(".chat-hist__row.is-on .chat-hist__dot").count()) === 1, "rows " + (await rows().count()));
ok("the rows carry no time label", (await page.locator(".chat-hist__w").count()) === 0);
ok("the drawer spans the whole chat area", await page.evaluate(() => { const d = document.querySelector(".chat-hist").getBoundingClientRect(), s = document.querySelector(".chatstage").getBoundingClientRect(); return Math.abs(d.width - s.width) < 2 && Math.abs(d.left - s.left) < 2; }));
ok("New conversation is the grey pill on the bar, with the X at the far right",
   await page.evaluate(() => { const bar = document.querySelector(".chat-hist__bar"); if (!bar) return false; const n = bar.querySelector(".chat-hist__new"), x = bar.querySelector(".chat-hist__close"); if (!n || !x) return false; const nb = n.getBoundingClientRect(), xb = x.getBoundingClientRect(), bb = bar.getBoundingClientRect(); return n.classList.contains("closebtn") && getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)" && xb.left > nb.right && bb.right - xb.right < 30; }));
ok("the X closes it", await (async () => { await page.click(".chat-hist__close"); await page.waitForTimeout(700); return !(await drawerOpen()); })());
ok("closed, the drawer waits below the chat area, not beside it", await page.evaluate(() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".chat-hist")).transform); return m.f > 100 && Math.abs(m.e) < 1; }));
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
ok("the continued chat is first now", (await rows().first().locator(".chat-hist__t").textContent()).trim().toLowerCase() === firstTopic.toLowerCase(), (await rows().allTextContents()).join(" | "));
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
