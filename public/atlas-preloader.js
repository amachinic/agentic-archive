(function () {
  "use strict";

  var root = document.documentElement;
  var overlay = document.querySelector("[data-atlas-preloader]");
  if (root.dataset.atlasBoot !== "loading" || !overlay || overlay.dataset.initialized === "true") return;
  overlay.dataset.initialized = "true";

  var canvas = overlay.querySelector("[data-atlas-preloader-canvas]");
  var pctEl = overlay.querySelector("[data-atlas-preloader-progress]");
  var veil = overlay.querySelector("[data-atlas-preloader-veil]");
  if (!(canvas instanceof HTMLCanvasElement) || !pctEl || !veil) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var actualProgress = Math.max(5, Number(root.dataset.atlasBootProgress) || 0);
  var appReady = root.dataset.atlasBootReady === "true";
  var leaving = false;
  var raf = 0;
  var fallbackTimer = 0;
  var reducedTimer = 0;

  function clampProgress(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function acceptProgress(value, ready) {
    actualProgress = Math.max(actualProgress, clampProgress(value));
    if (ready) {
      appReady = true;
      actualProgress = 100;
    }
    root.dataset.atlasBootProgress = String(Math.floor(actualProgress));
  }

  function onProgress(event) {
    var detail = event && event.detail;
    acceptProgress(typeof detail === "number" ? detail : detail && detail.progress, false);
  }

  function onReady() {
    acceptProgress(100, true);
  }

  window.addEventListener("atlas:boot-progress", onProgress);
  window.addEventListener("atlas:boot-ready", onReady);
  acceptProgress(actualProgress, appReady);

  function lockApp() {
    if (root.dataset.atlasBoot !== "loading") return;
    var app = document.querySelector(".app");
    if (app) {
      app.setAttribute("inert", "");
      app.setAttribute("aria-hidden", "true");
    }
    overlay.focus({ preventScroll: true });
    acceptProgress(15, false);
  }

  function unlockApp() {
    var app = document.querySelector(".app");
    if (app) {
      app.removeAttribute("inert");
      app.removeAttribute("aria-hidden");
    }
  }

  var appLockObserver;
  if (document.querySelector(".app")) {
    lockApp();
  } else if (document.readyState === "loading") {
    appLockObserver = new MutationObserver(function () {
      if (!document.querySelector(".app")) return;
      appLockObserver.disconnect();
      lockApp();
    });
    appLockObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", function () {
      appLockObserver.disconnect();
      lockApp();
    }, { once: true });
  } else {
    lockApp();
  }

  /* A failed image or client chunk must not strand the user behind a cover.
     This is only a release backstop; normal completion comes from GraphView. */
  fallbackTimer = window.setTimeout(function () {
    root.dataset.atlasBootFallback = "timeout";
    acceptProgress(100, true);
  }, 12000);

  /* The Atlas mark. */
  var MARK = [
    "M48.38,104.3c18.97-19.86,30.51-46.8,32.49-75.87.46-6.75.34-13.84.23-20.71-.03-1.96-.06-3.9-.08-5.82l-.02-1.98H17.06C7.56-.07-.14,7.63-.14,17.13v117.07c18.58-5.7,35.06-15.81,48.52-29.9Z",
    "M157.38,137.46c-18.57-15.1-47.48-25.24-71.93-25.24-3.58,0-7.06.21-10.26.63-29.09,2.27-54.39,14.27-75.33,35.7v6.18c0,9.5,7.7,17.21,17.21,17.21h137.59c9.5,0,17.21-7.7,17.21-17.21v-3.77c-4.22-4.56-9.01-9.04-14.48-13.49Z",
    "M154.65-.07h-73.66l6.27.08s-.03,4.89-.04,6.37c-.07,9.19-.13,18.7.74,27.44,2.61,27.12,14.68,52.65,33.97,71.88,13.83,13.98,31.16,24.07,49.91,29.42V17.13C171.86,7.63,164.15-.07,154.65-.07Z"
  ];
  var CUT = "M87.97,33.82c-.88-8.75-.81-18.25-.74-27.44.01-1.48.04-6.37.04-6.37l-6.27-.08.02,1.98c.02,1.92.05,3.86.08,5.82.11,6.86.23,13.96-.23,20.71-1.98,29.07-13.51,56.01-32.49,75.87-13.46,14.09-29.94,24.2-48.52,29.9v14.34c20.94-21.43,46.24-33.43,75.33-35.7,3.2-.41,6.68-.63,10.26-.63,24.45,0,53.36,10.15,71.93,25.24,5.47,4.45,10.26,8.93,14.48,13.49v-15.84c-18.75-5.35-36.08-15.44-49.91-29.42-19.29-19.22-31.36-44.75-33.97-71.88Z";

  var GRID = 80;
  var SIZE = 240;
  var STEP = 95;
  var dpr = (window.devicePixelRatio || 1) >= 1.5 ? 2 : 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  function markCanvas(resolution) {
    var mark = document.createElement("canvas");
    mark.width = resolution;
    mark.height = resolution;
    var markCtx = mark.getContext("2d");
    markCtx.scale(resolution / 172, resolution / 172);
    markCtx.fillStyle = "#f0f0f0";
    MARK.forEach(function (path) { markCtx.fill(new Path2D(path)); });
    markCtx.globalCompositeOperation = "destination-out";
    markCtx.fill(new Path2D(CUT));
    return mark;
  }

  var HIRES = SIZE * dpr;
  var hi = markCanvas(HIRES);
  var LADDER = [8, 10, 12, 16, 20, 24, 30, 40, 48, 60, 80];
  var targetsByGrid = {};
  LADDER.forEach(function (grid) {
    var mip = document.createElement("canvas");
    mip.width = grid;
    mip.height = grid;
    var mipCtx = mip.getContext("2d", { willReadFrequently: true });
    mipCtx.imageSmoothingEnabled = true;
    mipCtx.drawImage(hi, 0, 0, grid, grid);
    var data = mipCtx.getImageData(0, 0, grid, grid).data;
    var targets = new Float32Array(grid * grid);
    for (var i = 0; i < grid * grid; i += 1) targets[i] = data[i * 4 + 3] / 255;
    targetsByGrid[grid] = targets;
  });

  function hash(a, b) {
    var h = (a * 374761393 + b * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawCellsLayer(progress, step, closeT, introT, grid, layerAlpha) {
    var targets = targetsByGrid[grid];
    var cell = SIZE / grid;
    var gap = Math.max(1, Math.round(cell * 0.18)) * (1 - closeT);
    var radius = Math.max(1, Math.round(cell * 0.22)) * (1 - closeT);
    ctx.fillStyle = "#f0f0f0";
    for (var i = 0; i < grid * grid; i += 1) {
      var row = Math.floor(i / grid);
      var col = i % grid;
      var noise = reduced ? 0 : (0.05 + hash(i, step) * 0.62) * (1 - 0.35 * progress);
      var alpha = noise + (targets[i] - noise) * progress;
      if (introT < 1) {
        var coarse = LADDER[0];
        var key = Math.floor(row * coarse / grid) * coarse + Math.floor(col * coarse / grid);
        alpha *= Math.min(1, Math.max(0, (introT - hash(key, 7777) * 0.72) / 0.28));
      }
      alpha *= layerAlpha;
      if (alpha < 0.015) continue;
      ctx.globalAlpha = alpha;
      var x = col * cell + gap / 2;
      var y = row * cell + gap / 2;
      var size = cell - gap;
      if (radius > 0.1 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  var tmp = document.createElement("canvas");
  function drawResolution(amount) {
    var resolution = Math.min(HIRES, Math.round(GRID * Math.pow(HIRES / GRID, amount)));
    tmp.width = resolution;
    tmp.height = resolution;
    var tmpCtx = tmp.getContext("2d");
    tmpCtx.imageSmoothingEnabled = true;
    tmpCtx.drawImage(hi, 0, 0, resolution, resolution);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = resolution >= HIRES;
    ctx.drawImage(tmp, 0, 0, SIZE, SIZE);
  }

  var easeOutCubic = function (x) { return 1 - Math.pow(1 - x, 3); };
  var easeInOut = function (x) {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  };
  var LAND_MS = 350;
  var CLOSE_MS = 110;
  var REFINE_MS = 520;
  var HOLD_MS = 600;
  var INTRO_MS = 700;
  var COUNT_MS = reduced ? 0 : 2100;
  var TRAN_MS = 130;
  var shownPct = 0;
  var doneAt = null;
  var bornAt = null;
  var rungIdx = 0;
  var rungFrom = 0;
  var rungT0 = null;

  function finish() {
    if (leaving || root.dataset.atlasBoot !== "loading") return;
    leaving = true;
    window.clearTimeout(fallbackTimer);
    window.clearInterval(reducedTimer);
    try { sessionStorage.setItem("atlas-booted", "1"); } catch (error) {}
    veil.classList.add("is-on");
    root.dataset.atlasBoot = "leaving";
    window.setTimeout(function () {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("atlas:boot-progress", onProgress);
      window.removeEventListener("atlas:boot-ready", onReady);
      if (appLockObserver) appLockObserver.disconnect();
      unlockApp();
      root.dataset.atlasBoot = "ready";
      root.removeAttribute("aria-busy");
      delete root.dataset.atlasOverlay;
    }, reduced ? 130 : 510);
  }

  function frame(now) {
    if (root.dataset.atlasBoot !== "loading") return;
    raf = window.requestAnimationFrame(frame);
    if (bornAt === null) bornAt = now;
    var introT = reduced ? 1 : Math.min(1, (now - bornAt) / INTRO_MS);

    if (doneAt === null) {
      var timeCap = COUNT_MS === 0 ? 100 : Math.min(100, ((now - bornAt) / COUNT_MS) * 100);
      var target = Math.min(timeCap, actualProgress);
      var gain = target >= 100 ? 0.12 : 0.07;
      var floor = target >= 100 ? 0.9 : 0.5;
      shownPct = Math.min(target, shownPct + Math.max(floor, (target - shownPct) * gain));
      if (shownPct >= 99.5 && appReady) {
        shownPct = 100;
        pctEl.textContent = "100%";
        doneAt = now;
      } else {
        pctEl.textContent = String(Math.floor(shownPct)).padStart(2, "0") + "%";
      }

      if (reduced) {
        drawResolution(1);
        return;
      }

      var wantedRung = Math.min(LADDER.length - 1, Math.floor((shownPct / 100) * LADDER.length));
      if (wantedRung > rungIdx && rungT0 === null) {
        rungFrom = rungIdx;
        rungIdx = wantedRung;
        rungT0 = now;
      }
      var p = shownPct / 100;
      var step = Math.floor(now / STEP);
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (rungT0 !== null) {
        var transition = easeInOut(Math.min(1, (now - rungT0) / TRAN_MS));
        drawCellsLayer(p, step, 0, introT, LADDER[rungFrom], 1 - transition);
        drawCellsLayer(p, step, 0, introT, LADDER[rungIdx], transition);
        if (now - rungT0 >= TRAN_MS) rungT0 = null;
      } else {
        drawCellsLayer(p, step, 0, introT, LADDER[rungIdx], 1);
      }
      return;
    }

    var elapsed = now - doneAt;
    if (reduced) {
      drawResolution(1);
      if (elapsed > 100) finish();
    } else if (elapsed < LAND_MS) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      drawCellsLayer(1, 0, 0, 1, GRID, 1);
    } else if (elapsed < LAND_MS + CLOSE_MS) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      drawCellsLayer(1, 0, easeOutCubic((elapsed - LAND_MS) / CLOSE_MS), 1, GRID, 1);
    } else if (elapsed < LAND_MS + CLOSE_MS + REFINE_MS) {
      drawResolution(easeInOut((elapsed - LAND_MS - CLOSE_MS) / REFINE_MS));
    } else {
      drawResolution(1);
      if (elapsed > LAND_MS + CLOSE_MS + REFINE_MS + HOLD_MS) finish();
    }
  }

  if (reduced) {
    drawResolution(1);
    reducedTimer = window.setInterval(function () {
      if (root.dataset.atlasBoot !== "loading") {
        window.clearInterval(reducedTimer);
        return;
      }
      pctEl.textContent = String(Math.floor(actualProgress)).padStart(2, "0") + "%";
      if (!appReady) return;
      pctEl.textContent = "100%";
      window.clearInterval(reducedTimer);
      window.setTimeout(finish, 100);
    }, 100);
  } else {
    raf = window.requestAnimationFrame(frame);
  }
})();
