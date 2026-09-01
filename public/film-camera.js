/*
  The camera's arithmetic, on its own.

  The design studies under public/sandboxes/ are git-ignored on purpose --
  they are working notes, and #65 took them off the deployed archive for it.
  But the camera that films the product demo is not a working note. It is two
  pure functions that decide what a shot frames and where the window sits, and
  both of them encode things that were expensive to learn and silent when
  broken: a push that quietly resolves to no movement, a frame that slips off
  the app and shows the page behind it. Losing that to a .gitignore, as this
  machine nearly did when #65 landed and took ten untracked studies with it,
  would mean learning it twice.

  So the arithmetic lives here, tracked, and the study keeps the DOM plumbing:
  it reads the element, calls shotRect, hands the result to cameraTransform
  and writes the transform onto its frames. Nothing here touches the document,
  which is what lets scripts/film-camera-test.mjs assert the measured cases
  without a browser.

  Served from public/ because the study is a static page that loads it with a
  plain <script>; it is three kilobytes of maths and carries no notes.
*/
(function (root) {
  "use strict";

  /**
   * What a shot frames, in the app's own coordinate space.
   *
   * @param r    the subject's rect: {left, top, width, height}
   * @param opt  pad, max, maxH, keep, ay -- see below
   * @param VP   the app's design size, {w, h}
   * @returns    {x, y, w, h}, the rect the camera should fill
   */
  function shotRect(r, opt, VP) {
    opt = opt || {};
    var pad = opt.pad == null ? 48 : opt.pad;
    var x = r.left - pad, y = r.top - pad;
    var w = r.width + pad * 2, h = r.height + pad * 2;

    /* A subject taller than the frame can hold cancels the push in silence.
       shotRect fits the WHOLE subject, so a conversation panel that has grown
       to the stage floor asks for 1.5x and is handed 1.0 -- the camera says it
       is moving in and stands still. Measured on a take: the dock is 338px on
       a fresh page and 830 by act three, and the push resolved to 1.03x.

       maxH takes a WINDOW of the subject instead. Which end to keep is the
       caller's business: a conversation puts its newest line at the bottom, a
       drawer of tiles puts its header and first row at the top. */
    if (opt.maxH && h > opt.maxH) {
      if (opt.keep === "bottom") y += h - opt.maxH;
      h = opt.maxH;
    }

    /* Past about 1.6x a shot stops reading as the app and starts reading as a
       crop of it, so a small subject widens out to the cap rather than filling
       the window. */
    var maxZoom = opt.max || 1.5;
    var minW = VP.w / maxZoom, minH = VP.h / maxZoom;
    if (w < minW) { x -= (minW - w) / 2; w = minW; }
    if (h < minH) { y -= (minH - h) / 2; h = minH; }

    /* ay biases where the subject sits in the frame: 0.5 centres it, higher
       pushes the shot down the subject. Used to follow a reply as it is
       written, when the newest line would otherwise fall off the bottom. */
    if (opt.ay != null) y += (opt.ay - 0.5) * h;

    return { x: x, y: y, w: w, h: h };
  }

  /**
   * Where the window sits and how big the app is drawn, for a given shot.
   *
   * @param rect  the shot, from shotRect (or the wide rect)
   * @param view  the viewport in real pixels, {w, h}
   * @param VP    the app's design size, {w, h}
   * @returns     {s, tx, ty} -- scale, then translate, in that order
   */
  function cameraTransform(rect, view, VP) {
    /* No shot may be wider than the wide shot. Below that the app stops
       covering the viewport, the clamp underneath has nothing to clamp against
       and inverts, and the page behind comes up the left and top edges --
       measured before this floor existed, a 5.6px strip held for two whole
       acts of a take.

       The floor is the WIDE scale, not 1. In film mode they are the same
       thing, the viewport being exactly VP.w x VP.h, but the study is also read
       as an ordinary page where the frame is narrower and the honest wide shot
       is already below 1. Flooring at 1 there would blow every pull-back up to
       1:1 and crop the app instead -- which is the bug the obvious fix has. */
    var wideS = Math.min(view.w / VP.w, view.h / VP.h);
    var s = Math.max(wideS, Math.min(view.w / rect.w, view.h / rect.h));

    /* the window never slides off the app onto bare page */
    var clamp = function (v, lo, hi) { return lo > hi ? lo : Math.max(lo, Math.min(hi, v)); };
    var tx = clamp(view.w / 2 - (rect.x + rect.w / 2) * s, view.w - VP.w * s, 0);
    var ty = clamp(view.h / 2 - (rect.y + rect.h / 2) * s, view.h - VP.h * s, 0);

    return { s: s, tx: tx, ty: ty };
  }

  var api = { shotRect: shotRect, cameraTransform: cameraTransform };
  root.FilmCamera = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
