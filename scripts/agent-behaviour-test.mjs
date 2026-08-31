/*
  What the outside hunt PROMISES, checked against a real model.

  Run scripts/model-bridge.mjs first and point the dev server at it; then this
  drives three ordinary turns and asserts the manners, not the plumbing:

    · a hunt with no number is a PREVIEW that ends — a few probes in different
      registers, then stop, rather than grinding toward a quota
    · the reply quotes the REAL population, so the human knows a preview is a
      preview and not the whole well
    · "pull more" CONTINUES the same words instead of inventing new ones,
      which would lose their place
    · being told to leave it alone is respected, once, without re-offering

  These are the four ways the workflow can be technically correct and still
  feel wrong to use, and none of them is visible to a type-checker.
*/
const URL = "http://localhost:4400/api/agent";
const res = [];
const ok = (n, pass, d) => { res.push(pass); console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        " + d : "")); };

let continuation = {}, strip = [], messages = [];
function merge(prev, next) {
  if (!next?.items?.length) return prev;
  if (!next.pulled) return next.items.slice(0, 1000);
  const seen = new Set(prev.map((c) => c.source + ":" + c.remoteId));
  const out = prev.slice();
  for (const c of next.items) {
    const k = c.source + ":" + c.remoteId;
    if (!seen.has(k) && out.length < 1000) { seen.add(k); out.push(c); }
  }
  return out;
}
async function turn(text) {
  messages.push({ role: "user", content: text });
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, field: [], historian: true, mute: [], continuation,
      stripHeld: strip.length, stripKeys: strip.map((c) => c.source + ":" + c.remoteId) }) });
  const d = await r.json();
  if (!r.ok) throw new Error("HTTP " + r.status + " " + d.error);
  messages.push({ role: "assistant", content: d.reply });
  if (d.continuation) continuation = d.continuation;
  strip = merge(strip, d.candidates);
  const calls = (d.toolLog ?? []).filter((t) => t.tool === "search_outside");
  return { d, calls, reply: String(d.reply ?? "") };
}

console.log("═══ TURN 1 — an open hunt, no number named");
const t1 = await turn("Find me sad images from the outside sources.");
console.log(`   probes: ${t1.calls.map((c) => JSON.stringify(c.args)).join("  ")}`);
console.log(`   strip: ${strip.length}`);
console.log(`   reply: ${t1.reply}`);
ok("previews rather than grinding (≤4 probes)", t1.calls.length > 0 && t1.calls.length <= 4, `${t1.calls.length} probes`);
ok("probes different words each time (a real plan)",
   new Set(t1.calls.map((c) => c.args?.query)).size === t1.calls.length,
   t1.calls.map((c) => c.args?.query).join(" / "));
const n1 = strip.length;
ok("preview within the 40 cap", n1 > 0 && n1 <= 40, `${n1} on the table`);
const saysScale = /\b\d[\d,]{2,}\b/.test(t1.reply);
ok("reply quotes the real scale", saysScale, saysScale ? "a population figure appears in the reply" : "no number in reply");
const offers = /(refine|narrow|pull|more|deeper)/i.test(t1.reply);
ok("reply offers a way onward", offers);

console.log("\n═══ TURN 2 — 'more' must CONTINUE, not restart");
const t2 = await turn("Pull more of those.");
console.log(`   probes: ${t2.calls.map((c) => JSON.stringify(c.args)).join("  ")}`);
console.log(`   strip: ${n1} → ${strip.length}`);
console.log(`   reply: ${t2.reply}`);
ok("used more:true (continued, did not invent new words)",
   t2.calls.some((c) => c.args?.more === true),
   t2.calls.map((c) => `${c.args?.query} more=${c.args?.more ?? false}`).join(" / "));
ok("the strip grew", strip.length > n1, `${n1} → ${strip.length}`);
const uniq = new Set(strip.map((c) => c.source + ":" + c.remoteId)).size;
ok("no duplicates after the pull", uniq === strip.length, `${uniq}/${strip.length}`);

console.log("\n═══ TURN 3 — leaving it alone must not be nagged");
const t3 = await turn("That's fine, leave it there for now.");
console.log(`   probes: ${t3.calls.length}`);
console.log(`   reply: ${t3.reply}`);
ok("respects a stop — no further probing", t3.calls.length === 0, `${t3.calls.length} probes`);
ok("does not re-offer after being told to stop",
   !/would you like|shall i|want me to|should i pull/i.test(t3.reply), t3.reply.slice(0, 120));

const pass = res.filter(Boolean).length;
console.log(`\n═══ ${pass}/${res.length} PASS`);
