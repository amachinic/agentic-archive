/*
  Render the portfolio card artwork.

  Not the same job as film-run.mjs. That one drives the live app and films
  what it does; this one films a COMPOSITION: the finished clip sitting
  inside a frame on a pale ground, captured as a single piece of artwork
  the card can crop into.

  The card has no fixed aspect. It runs about 1.61:1 at 1440x900 and 2.11:1
  at 1920x1080, and object-fit cover eats the difference, so the frame here
  carries its own margin: 264px of ground either side of the product, which
  cover can take without touching it.

  Capture is the same CDP screencast used for the app film, for the same
  reason: Playwright's recordVideo grabs at CSS resolution and encodes VP8
  at a low fixed bitrate, which smears fine rules and small type.

  Outputs the four files the portfolio's card contract expects:
    <name>.av1.webm   best, needs a recent browser
    <name>.webm       VP9
    <name>.mp4        h264, covers everything
    <name>-poster.jpg the still shown until the clip can play

    node scripts/film-card.mjs --out public/card/image-archivist
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };

const BASE   = flag("base", "http://localhost:4400");
const PAGE   = flag("page", "/card-art.html");
const WIDTH  = Number(flag("width", 1920));
const HEIGHT = Number(flag("height", 1008));
const FPS    = Number(flag("fps", 30));
const OUT    = path.resolve(flag("out", "public/card/image-archivist"));
const RAW    = path.resolve(".cardfilm");
const POSTER_AT = Number(flag("poster", 3));   // seconds into the clip

const log = (m) => console.log("  " + m);
const pad = (n) => String(n).padStart(6, "0");

function ffmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(label + " failed: " + err.slice(-700)))));
  });
}

async function main() {
  const ping = await fetch(BASE + PAGE).catch(() => null);
  if (!ping || !ping.ok) throw new Error("nothing serving " + BASE + PAGE + " -- start `npm run dev` first");

  await rm(RAW, { recursive: true, force: true });
  await mkdir(RAW, { recursive: true });
  await mkdir(path.dirname(OUT), { recursive: true });

  log("composing at " + WIDTH + "x" + HEIGHT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const length = await page.evaluate(() => window.__len());
  log("inner clip is " + length.toFixed(1) + "s");

  const client = await ctx.newCDPSession(page);
  const stamps = [];
  const writes = [];
  let count = 0, rolling = false;

  client.on("Page.screencastFrame", (f) => {
    client.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (!rolling) return;
    stamps.push(f.metadata.timestamp);
    writes.push(writeFile(path.join(RAW, pad(++count) + ".jpg"), Buffer.from(f.data, "base64")));
  });

  await client.send("Page.startScreencast", {
    format: "jpeg", quality: 95, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1,
  });
  log("starting playback");
  /* rolling AFTER the first frame is on screen, not before: see __play in card-art.html */
  await page.evaluate(() => window.__play());
  rolling = true;
  log("rolling one pass");
  /* one full pass of the inner clip, read off the element rather than timed:
     a dropped frame or a slow decode must not truncate the loop */
  await page.waitForFunction(
    () => window.__at() >= window.__len() - 0.12,
    null,
    { timeout: Math.round((length + 45) * 1000), polling: 200 },
  );

  rolling = false;
  await client.send("Page.stopScreencast").catch(() => {});
  await Promise.all(writes);
  log(count + " frames captured");
  if (count < 60) throw new Error("the screencast produced almost nothing (" + count + " frames)");
  await ctx.close();
  await browser.close();

  /* variable-rate frames carry their own durations into a concat list */
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < count; i++) {
    const d = i + 1 < count ? stamps[i + 1] - stamps[i] : 1 / FPS;
    list += "file '" + pad(i + 1) + ".jpg'\nduration " + Math.max(1 / 240, d).toFixed(5) + "\n";
  }
  list += "file '" + pad(count) + ".jpg'\n";
  const listPath = path.join(RAW, "frames.ffconcat");
  await writeFile(listPath, list);

  const src = ["-f", "concat", "-safe", "0", "-i", listPath];
  const vf = ["-vf", "fps=" + FPS + ",format=yuv420p"];
  /* sRGB screen content, tagged so players stop guessing at it */
  const tag = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "pc"];

  log("h264");
  await ffmpeg(["-y", ...src, ...vf, "-c:v", "libx264", "-preset", "slow", "-crf", "21",
    "-profile:v", "high", "-bf", "0", "-g", String(FPS * 2), ...tag,
    "-movflags", "+faststart", "-muxdelay", "0", "-muxpreload", "0", "-an", OUT + ".mp4"], "h264");

  log("vp9");
  await ffmpeg(["-y", ...src, ...vf, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
    "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", ...tag, "-an", OUT + ".webm"], "vp9");

  log("av1");
  await ffmpeg(["-y", ...src, ...vf, "-c:v", "libsvtav1", "-crf", "38", "-preset", "6",
    ...tag, "-an", OUT + ".av1.webm"], "av1");

  log("poster");
  await ffmpeg(["-y", "-ss", String(POSTER_AT), ...src, "-frames:v", "1",
    "-q:v", "4", OUT + "-poster.jpg"], "poster");

  /* The loop seam, checked rather than assumed. The card plays this on repeat, so frame 0 is
     spliced straight onto the last frame every time round: if the head of the clip is the bare
     ground, that is a white flash once per loop. It happened, and only measuring caught it. */
  const lumaAt = (t) => new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-ss", String(t), "-i", OUT + ".mp4", "-frames:v", "1",
      "-vf", "scale=32:20,format=gray", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const c = [];
    p.stdout.on("data", (d) => c.push(d));
    p.on("close", () => { const b = Buffer.concat(c); let s = 0; for (const v of b) s += v; resolve(b.length ? s / b.length : -1); });
    p.on("error", () => resolve(-1));
  });
  const head = await lumaAt(0);
  const body = await lumaAt(1);
  log("loop seam: frame 0 luma " + head.toFixed(1) + " against " + body.toFixed(1) + " a second in");
  if (Math.abs(head - body) > 12) {
    throw new Error("frame 0 does not match the clip (" + head.toFixed(1) + " vs " + body.toFixed(1) + "): the loop would flash");
  }

  await rm(RAW, { recursive: true, force: true });

  const { stat } = await import("node:fs/promises");
  console.log("");
  for (const ext of [".av1.webm", ".webm", ".mp4", "-poster.jpg"]) {
    const s = await stat(OUT + ext).catch(() => null);
    console.log("  " + (OUT + ext).padEnd(64) + (s ? (s.size / 1024).toFixed(0) + " KB" : "missing"));
  }
}

main().catch(async (e) => {
  console.error("\n  the render failed: " + (e && e.message ? e.message : e));
  if (existsSync(RAW)) {
    const n = (await readdir(RAW).catch(() => [])).filter((f) => f.endsWith(".jpg")).length;
    console.error("  " + n + " captured frames kept in " + RAW);
  }
  process.exit(1);
});
