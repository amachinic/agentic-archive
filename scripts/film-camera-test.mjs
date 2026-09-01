/*
  What the camera PROMISES, checked against the cases that broke it.

  Every assertion here is a measurement taken off a real take, not a number
  invented to make a test pass. The camera's failures are all silent -- a push
  that resolves to no movement still looks like a camera holding a shot, and a
  frame three pixels wider than the app still looks like a frame until you
  find the strip of page down its edge -- so none of this is visible to a
  type-checker and none of it raises an error at runtime.

    node scripts/film-camera-test.mjs
*/
import { createRequire } from "node:module";
const { shotRect, cameraTransform } = createRequire(import.meta.url)("../public/film-camera.js");

const VP = { w: 1500, h: 940 };
const FILM = { w: 1500, h: 940 };          // the film viewport is 1:1 with the app
const res = [];
const ok = (n, pass, d) => { res.push(pass); console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        " + d : "")); };
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

/* the scale a shot actually lands at, which is the only number that matters */
const scaleOf = (r, opt, view = FILM) => cameraTransform(shotRect(r, opt, VP), view, VP).s;

console.log("\n═══ a tall subject still gets its push");
{
  /* the dock at act three, measured: 920x830 at x=580,y=109 */
  const dock = { left: 580, top: 109, width: 920, height: 830 };
  const without = scaleOf(dock, { max: 1.5, pad: 40 });
  const withMaxH = scaleOf(dock, { max: 1.5, pad: 40, maxH: 500 });
  ok("without maxH the push collapses to about 1x", near(without, 1.0, 0.06),
     `asked 1.5x, got ${without.toFixed(3)}x — this is the silent failure`);
  ok("with maxH it resolves to the 1.5x it asked for", near(withMaxH, 1.5),
     `got ${withMaxH.toFixed(3)}x`);
}

console.log("\n═══ the conversation keeps its newest line");
{
  /* the chat panel at act three: 520 wide, grown to the stage floor */
  const chat = { left: 980, top: 109, width: 520, height: 830 };
  const s = scaleOf(chat, { max: 1.5, pad: 56, maxH: 560, keep: "bottom" });
  ok("a bottom-kept window pushes to 1.5x", near(s, 1.5), `got ${s.toFixed(3)}x`);

  const top = shotRect(chat, { max: 1.5, pad: 56, maxH: 560 }, VP);
  const bot = shotRect(chat, { max: 1.5, pad: 56, maxH: 560, keep: "bottom" }, VP);
  ok("keep:bottom frames lower than the default", bot.y > top.y,
     `top-kept y=${top.y.toFixed(0)}, bottom-kept y=${bot.y.toFixed(0)}`);
}

console.log("\n═══ no shot is ever wider than the app");
{
  /* the exact rect that put a 5.6px strip of bare page in a take */
  const tall = { left: 980, top: 109, width: 520, height: 832 };
  const t = cameraTransform(shotRect(tall, { max: 1.5, pad: 56 }, VP), FILM, VP);
  ok("the floor holds the scale at 1 in film mode", t.s >= 1,
     `s=${t.s.toFixed(4)}; unfloored this was 0.9963`);
  ok("and the window sits flush, with nothing behind it", t.tx <= 0 && t.ty <= 0,
     `tx=${t.tx.toFixed(1)} ty=${t.ty.toFixed(1)} — positive means bare page`);
}

console.log("\n═══ but the floor is the wide shot, not 1");
{
  /* The study read as an ordinary page: the frame is narrower than the app,
     so the honest wide shot is already below 1 and must stay there.

     The viewport TRACKS the app aspect -- the page sets its height from its
     own width (windowH), so view.h/VP.h always equals view.w/VP.w. That is
     what makes the clamp exact rather than merely safe: with the two ratios
     equal the wide shot fills the frame in both axes and there is no
     letterbox for the window to sit inside. A test that invents a viewport
     ignoring this asserts against a state the page cannot be in. */
  const narrow = { w: 1160, h: Math.round(VP.h * (1160 / VP.w)) };
  const wide = { x: 0, y: 0, w: VP.w, h: VP.h };
  const t = cameraTransform(wide, narrow, VP);
  const expected = Math.min(narrow.w / VP.w, narrow.h / VP.h);
  ok("a pull-back in a narrow window is not blown up to 1:1", near(t.s, expected, 0.0001),
     `s=${t.s.toFixed(4)}, wide scale is ${expected.toFixed(4)} — flooring at 1 would crop ${Math.round(VP.w - narrow.w)}px`);
  /* Under a pixel, not zero: windowH rounds to an integer height, so the
     frame can miss the app aspect by half a pixel and the fit is loose by the
     same. That is not the failure the floor exists to catch -- that one was
     5.6px, held steady for two acts of a take. A rounding is allowed to
     exist; a strip is not. */
  ok("and it still cannot show a visible strip of page", t.tx <= 1 && t.ty <= 1,
     `tx=${t.tx.toFixed(3)} ty=${t.ty.toFixed(3)} — sub-pixel, from the integer viewport height`);
}

console.log("\n═══ a small subject widens out rather than filling the frame");
{
  const chip = { left: 700, top: 400, width: 90, height: 30 };
  const r = shotRect(chip, { max: 1.5 }, VP);
  ok("it is opened out to the zoom cap", near(r.w, VP.w / 1.5) && near(r.h, VP.h / 1.5),
     `${r.w.toFixed(0)}x${r.h.toFixed(0)} against the cap's ${(VP.w / 1.5).toFixed(0)}x${(VP.h / 1.5).toFixed(0)}`);
  ok("and stays centred on the subject", near(r.x + r.w / 2, 745) && near(r.y + r.h / 2, 415),
     `centre ${(r.x + r.w / 2).toFixed(0)},${(r.y + r.h / 2).toFixed(0)} against the chip's 745,415`);
}

const pass = res.filter(Boolean).length;
console.log(`\n═══ ${pass}/${res.length} PASS`);
process.exit(pass === res.length ? 0 : 1);
