/*
  Film the sandbox's full run to an mp4.

  The take is the real thing: a real browser on the real dev server, playing
  the real agent against the real library. Nothing here fakes a frame -- it
  only decides where the camera sits and when to stop rolling.

  Capture is a CDP screencast, NOT Playwright's recordVideo. recordVideo
  grabs at CSS resolution and encodes VP8 at a low fixed bitrate; it is a
  debugging aid, and on a dark UI full of small mono type it smears. The
  screencast hands back the compositor's own frames at the device pixel
  ratio instead -- so at --scale 2 every glyph is sampled at twice the
  output resolution and the downscale supersamples it back. Chrome emits a
  frame only when something changed, so the frames are variable-rate and
  their own timestamps drive a concat list rather than being assumed even.

    npm run film                        # 1600x1000 at 2x, headless
    npm run film -- --scale 3           # 3x source, same output size
    npm run film -- --native            # keep the full 2x frame (3200x2000)
    npm run film -- --headed --out demo.mp4
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes("--" + n);

const BASE    = flag("base", "http://localhost:4400");
/* The app is laid out at 1500x940 and film mode gives it the whole window,
   so a viewport of exactly that means the wide shot is 1:1 -- no scale
   transform in the path at all. Capture is still --scale x that. */
const WIDTH   = Number(flag("width", 1500));
const HEIGHT  = Number(flag("height", 940));
const SCALE   = Number(flag("scale", 2));    // device pixel ratio of the capture
const FPS     = Number(flag("fps", 30));     // constant rate of the finished file
const CRF     = Number(flag("crf", 16));     // 16 is visually lossless on UI
const OUT     = path.resolve(flag("out", "run.mp4"));
const RAW     = path.resolve(".film");
const CEILING = Number(flag("timeout", 600)) * 1000;
/* the studies live under /sandboxes/ since #65 -- public/, so next dev still
   serves them, but git-ignored so they never reach the deployed archive */
const PAGE    = flag("page", "/sandboxes/agent-sandbox.html");

const log = (m) => console.log("  " + m);
const pad = (n) => String(n).padStart(6, "0");

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-900)))));
  });
}

async function main() {
  const ping = await fetch(BASE + PAGE).catch(() => null);
  if (!ping || !ping.ok) throw new Error("nothing serving " + BASE + PAGE + " -- start `npm run dev` first, and check public/sandboxes/ still has the study (it is git-ignored, so a fresh clone will not)");

  await rm(RAW, { recursive: true, force: true });
  await mkdir(RAW, { recursive: true });

  log("launching " + WIDTH + "x" + HEIGHT + " at " + SCALE + "x  (capture " + WIDTH * SCALE + "x" + HEIGHT * SCALE + ")");
  const browser = await chromium.launch({ headless: !has("headed") });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();

  /* A take can die inside the app rather than inside this script -- a React
     crash unmounts the composer and every later step then times out looking
     for it. Collect the evidence so a bad take says why instead of just
     which selector went missing. */
  const trouble = [];
  page.on("pageerror", (e) => trouble.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") trouble.push("console: " + m.text().slice(0, 200)); });
  page.on("crash", () => trouble.push("the page crashed"));

  await page.addInitScript(() => { try { sessionStorage.setItem("atlas-booted", "1"); } catch (e) {} });

  /* ?film=1 strips the page to the app: no intro, tabs, chips, play button
     or readout, and the frame loses its card border and rounded corners.
     It also selects the run tab itself, since the tab bar is gone. */
  await page.goto(BASE + PAGE + "?film=1", { waitUntil: "domcontentloaded" });

  /* The frame boots the whole app. Wait for the field to actually carry
     cards -- the canvas mounts empty and the pool lands after it, and an
     opening frame of black placeholders is not the shot.

     It also must not be showing a Next error. <nextjs-portal> is present on
     every dev page whether or not anything is wrong -- healthy, its shadow
     root holds only styles and it measures 0x0 -- so the signal is the
     dialog inside it, not the element. A take rolled over one films a red
     error card instead of the app, which is what happened silently after an
     npm install reorganised node_modules under the running dev server.
     devIndicators:false hides the badge, never the errors. */
  /* the predicate has to live in the page, where document and the frames
     are; installing it once keeps the two callers below in agreement */
  await page.evaluate(() => {
    window.__atlasErrorUp = () => {
      const bad = (root) => Array.from(root ? root.querySelectorAll("nextjs-portal") : []).some((el) => {
        const sr = el.shadowRoot;
        if (sr && sr.querySelector("[data-nextjs-dialog], [data-nextjs-error-overlay]")) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (bad(document)) return true;
      for (const id of ["rframe", "rframe2"]) {
        const f = document.getElementById(id);
        try { if (f && f.contentDocument && bad(f.contentDocument)) return true; } catch (e) { /* mid-navigation */ }
      }
      return false;
    };
  });

  log("waiting for the app to come up in the frame");
  await page.waitForFunction(() => {
    if (window.__atlasErrorUp && window.__atlasErrorUp()) return false;
    const f = document.getElementById("rframe");
    const d = f && f.contentDocument;
    if (!d || !d.querySelector(".graph-stage canvas")) return false;
    const pill = d.querySelector(".topbar .pill");
    return !!pill && parseInt(pill.textContent.replace(/[^0-9]/g, ""), 10) > 0;
  }, null, { timeout: 90000 });

  log("letting thumbnails load");
  await page.waitForTimeout(6000);

  /* film mode pins the body, so there is no scroll to agree about */
  await page.waitForTimeout(1500);

  /* Wait for the field to stop moving, rather than for a number of seconds
     that once looked long enough.

     Not for the loop -- the encode guarantees that join now -- but for the
     opening shot itself: rolling while thumbnails are still landing means
     the take starts with cards quietly popping in, which reads as a page
     that has not finished loading rather than as an archive at rest.

     The comparison runs inside the page, against the app's own canvas, so
     it can be cheap and tolerant at the same time. Exact equality was
     neither: a single card still waiting on its thumbnail keeps a shimmer
     band sweeping across it forever, and the wait simply timed out every
     take. A downsample and a small threshold ignore that and still catch a
     field that is genuinely still arranging itself. */
  {
    const settled = await page.evaluate(async () => {
      const grab = () => {
        const f = document.getElementById("rframe");
        const c = f && f.contentDocument && f.contentDocument.querySelector(".graph-stage canvas");
        if (!c) return null;
        const o = document.createElement("canvas");
        o.width = 96; o.height = 60;
        const g = o.getContext("2d");
        try { g.drawImage(c, 0, 0, 96, 60); return g.getImageData(0, 0, 96, 60).data; }
        catch (e) { return null; }   /* a tainted canvas is not worth failing a take over */
      };
      const apart = (a, b) => {
        let sum = 0;
        for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
        return sum / (a.length / 4);
      };
      let last = null, stable = 0;
      const stop = performance.now() + 40000;
      while (performance.now() < stop) {
        const now = grab();
        if (!now) return null;
        /* 2.0, not 0: a card still waiting on its thumbnail keeps a shimmer
           band sweeping across it, and that never stops. Measured, arrivals
           take the frame-to-frame figure from 18 down to about 1.3 within
           three seconds and it then sits there for as long as you watch. The
           threshold sits above that floor so it reads arrivals, not decor. */
        if (last && apart(last, now) < 2) { if (++stable >= 3) return true; } else stable = 0;
        last = now;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    });
    log(settled === null ? "could not read the field to check it had settled"
      : settled ? "the field has settled"
      : "the field is still moving -- rolling anyway");
  }

  /* ---- roll ---- */
  const client = await ctx.newCDPSession(page);
  const stamps = [];
  const writes = [];
  let count = 0, rolling = false;

  client.on("Page.screencastFrame", (f) => {
    /* ack first and always, or Chrome stops sending after a handful */
    client.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (!rolling) return;
    stamps.push(f.metadata.timestamp);
    writes.push(writeFile(path.join(RAW, pad(++count) + ".jpg"), Buffer.from(f.data, "base64")));
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,                     // q100 triples the bytes for no visible gain
    maxWidth: WIDTH * SCALE,
    maxHeight: HEIGHT * SCALE,
    everyNthFrame: 1,
  });
  rolling = true;

  /* An overlay can also arrive part-way through a take -- a stray recompile
     is enough. Watch for it rather than discovering it in the finished mp4. */
  let overlaySeen = false;
  const overlayWatch = setInterval(async () => {
    try {
      const up = await page.evaluate(() => !!(window.__atlasErrorUp && window.__atlasErrorUp()));
      if (up) overlaySeen = true;
    } catch (e) { /* navigating between frames */ }
  }, 500);

  log("rolling");
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById("runplay").click());
  await page.waitForFunction(() => document.body.dataset.run === "done", null, { timeout: CEILING });
  await page.waitForTimeout(400);    // the run already holds to its own out-point

  rolling = false;
  clearInterval(overlayWatch);
  await client.send("Page.stopScreencast").catch(() => {});
  await Promise.all(writes);
  log("take finished in " + Math.round((Date.now() - t0) / 1000) + "s  ·  " + count + " frames");
  if (count < 30) throw new Error("the screencast produced almost nothing (" + count + " frames)");

  const readout = await page.$$eval("#rnarr .narr__n", (ns) =>
    ns.map((n) => {
      const k = n.querySelector(".k"), t = n.querySelector(".t");
      return ((k && k.textContent) || "").padEnd(10) + " " + ((t && t.textContent) || "");
    })
  );
  const stopped = readout.filter((r) => r.startsWith("stopped"));
  await ctx.close();
  await browser.close();
  if (overlaySeen) {
    console.error("\n  a Next.js error overlay was on screen during the take");
    for (const t of trouble.slice(0, 8)) console.error("    " + t);
    throw new Error("the app errored while filming -- not encoding it");
  }

  /* A take that stopped early is not worth encoding: it would end mid-run
     and never loop. Say what the run reported and what the browser said. */
  if (stopped.length) {
    console.error("\n  the run reported: " + stopped.join(" | "));
    for (const t of trouble.slice(0, 8)) console.error("    " + t);
    throw new Error("the take is incomplete -- not encoding it");
  }

  /* A still hold is a single frame that has to last, so every entry carries
     its own measured duration and ffmpeg resamples the lot to a fixed rate. */
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < count; i++) {
    const d = i + 1 < count ? stamps[i + 1] - stamps[i] : 1 / FPS;
    list += "file '" + pad(i + 1) + ".jpg'\nduration " + Math.max(1 / 240, d).toFixed(5) + "\n";
  }
  list += "file '" + pad(count) + ".jpg'\n";  // concat drops a trailing frame without this
  const listPath = path.join(RAW, "frames.ffconcat");
  await writeFile(listPath, list);

  const total = Math.max(0.2, stamps[count - 1] - stamps[0] + 1 / FPS);

  /*
    The join, made exact rather than hoped for.

    The take ends on a SECOND app, booted on the standby frame and settled
    while the first one worked, so the closing shot is the library as it was
    before any of this. Two separate instances of the same app get very
    close and no closer: with both ends held perfectly still, cards still
    landed about 1.3px apart, which reads as the whole field twitching every
    time the card loops.

    So the last half second dissolves into THIS take's own opening frame.
    The final frame is then the first frame, because it is literally the
    same picture -- and the standby is already almost that image, so the
    correction has nothing to show. It is a guarantee, where matching two
    live instances could only ever be a good attempt.
  */
  const HEAD = path.join(RAW, pad(1) + ".jpg");
  const JOIN = 0.5;
  const chain = (has("native") ? "" : "scale=" + WIDTH + ":" + HEIGHT + ":flags=lanczos,") + "fps=" + FPS;
  /* format comes AFTER the blend: xfade renegotiates the pixel format with
     its inputs and hands back one libx264 will not accept as high profile,
     which fails the encode outright. */
  const vf = "[0:v]" + chain + "[m];[1:v]" + chain + "[s];"
    + "[m][s]xfade=transition=fade:duration=" + JOIN.toFixed(3)
    + ":offset=" + (total - JOIN).toFixed(3) + ",format=yuv420p[v]";

  log("encoding  crf " + CRF + "  " + FPS + "fps" + (has("native") ? "  native " + WIDTH * SCALE + "x" + HEIGHT * SCALE : ""));
  await ffmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    /* the opening frame, held just long enough to be dissolved into */
    "-loop", "1", "-t", (JOIN + 2 / FPS).toFixed(3), "-i", HEAD,
    "-filter_complex", vf, "-map", "[v]",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(CRF),
    "-profile:v", "high",
    /* Screen content is sRGB. Left untagged, ffmpeg wrote color_space
       bt470bg with an unknown transfer, so every player applied its own
       guess -- which on a UI built from #0d0d0d panels over a #020202 page
       flattened the greys into one black. Tag bt709 full-range, in the
       container AND the bitstream, so the picture decodes to the same
       values the browser painted. */
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-color_range", "pc",
    "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=on",
    /* no B-frames: they push the mp4's start_time off zero, and some Windows
       players (Films & TV among them) open such a file blank */
    "-bf", "0", "-g", String(FPS * 2),
    "-movflags", "+faststart", "-muxdelay", "0", "-muxpreload", "0",
    "-an", OUT,
  ]);
  await rm(RAW, { recursive: true, force: true });

  /* Look at the finished file rather than trusting the pipeline: frame one
     of a good take is a lit dashboard. A dark opening frame means the app
     was not rendering, which is exactly the failure a black-corner check
     read as success once. */
  const opening = await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-ss", "1", "-i", OUT, "-frames:v", "1",
      "-vf", "scale=80:50,format=gray", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("close", () => {
      const b = Buffer.concat(chunks);
      let sum = 0;
      for (const v of b) sum += v;
      resolve(b.length ? sum / b.length : 0);
    });
    p.on("error", () => resolve(0));
  });
  log("opening frame mean luma " + opening.toFixed(1));
  if (opening < 12) throw new Error("the opening frame is nearly black (" + opening.toFixed(1) + ") -- the app was not on screen");

  /* Colour fidelity, not just brightness. The sidebar is painted --surface
     (#0d0d0d = 13) over a --bg (#020202 = 2) page: eleven levels apart, and
     the first thing a mis-tagged colour space flattens. Decode it back and
     insist the two planes still differ. */
  const sample = (x, y) => new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-ss", "12", "-i", OUT, "-frames:v", "1",
      "-filter:v", "crop=1:1:" + x + ":" + y + ",format=rgb24", "-f", "rawvideo", "-"],
      { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("close", () => { const b = Buffer.concat(chunks); resolve(b.length ? b[0] : -1); });
    p.on("error", () => resolve(-1));
  });
  /* Two points that are always the same thing: empty sidebar below the nav,
     and the strip of page under the rail on the far right. Sampling the
     field itself is no good -- there is usually a thumbnail in the way. */
  const railPx = await sample(60, 300);
  log("sidebar reads " + railPx + "  (--surface #0d0d0d = 13)");
  if (Math.abs(railPx - 13) > 3) {
    throw new Error("the sidebar decoded as " + railPx + ", not 13 -- the encode shifted the greys");
  }

  /* The join, checked in the finished file rather than trusted to the
     arithmetic that set it up. The last frame should now BE the first
     frame, so anything past encoder noise means the dissolve did not land
     where it was told to. */
  const seam = await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", OUT,
      "-filter_complex",
      "[0:v]select='eq(n,0)',setpts=N/FRAME_RATE/TB[a];" +
      "[0:v]reverse,select='eq(n,0)',setpts=N/FRAME_RATE/TB[b];" +
      "[a][b]blend=all_mode=difference,format=gray",
      "-frames:v", "1", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("close", () => {
      const b = Buffer.concat(chunks);
      let sum = 0;
      for (const v of b) sum += v;
      resolve(b.length ? sum / b.length : -1);
    });
    p.on("error", () => resolve(-1));
  });
  log("loop join: last frame against first, mean difference " + seam.toFixed(2));
  if (seam > 1.5) {
    throw new Error("the last frame is not the first frame (" + seam.toFixed(2) + ") -- the loop would jump");
  }

  console.log("\n  " + OUT);
  console.log("\n  what the agent did on this take:");
  readout.forEach((r) => console.log("    " + r));
}

main().catch(async (e) => {
  console.error("\n  the take failed: " + (e && e.message ? e.message : e));
  if (existsSync(RAW)) {
    const n = (await readdir(RAW).catch(() => [])).filter((f) => f.endsWith(".jpg")).length;
    console.error("  " + n + " captured frames kept in " + RAW);
  }
  process.exit(1);
});
