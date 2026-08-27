const startPreloaderScript = `(function(){
  var root=document.documentElement;
  if(root.dataset.atlasBoot!=="loading")return;
  root.dataset.atlasOverlay="mounted";
  var script=document.createElement("script");
  script.src="/atlas-preloader.js";
  script.async=true;
  script.dataset.atlasPreloaderRuntime="";
  script.onerror=function(){
    try{sessionStorage.setItem("atlas-booted","1")}catch(e){}
    root.dataset.atlasBoot="ready";
    root.removeAttribute("aria-busy");
  };
  document.head.appendChild(script);
  window.setTimeout(function(){
    if(root.dataset.atlasBoot!=="loading")return;
    try{sessionStorage.setItem("atlas-booted","1")}catch(e){}
    var app=document.querySelector(".app");
    if(app){app.removeAttribute("inert");app.removeAttribute("aria-hidden")}
    root.dataset.atlasBootFallback="runtime";
    root.dataset.atlasBoot="ready";
    root.removeAttribute("aria-busy");
  },15000);
})();`;

/**
 * Server-rendered first so it can cover the viewport before any client bundle
 * runs. Its runtime is deliberately plain browser JavaScript: the dashboard
 * is free to hydrate underneath it instead of waiting for this component.
 */
export default function AtlasPreloader() {
  return (
    <>
      <div
        className="atlas-preloader"
        data-atlas-preloader
        role="status"
        aria-labelledby="atlas-preloader-label"
        tabIndex={-1}
        suppressHydrationWarning
      >
        <span id="atlas-preloader-label" className="u-visually-hidden">
          Loading Atlas and preparing the image network
        </span>
        <canvas
          className="atlas-preloader__canvas"
          data-atlas-preloader-canvas
          aria-hidden="true"
          suppressHydrationWarning
        />
        <span
          className="atlas-preloader__percent"
          data-atlas-preloader-progress
          aria-hidden="true"
          suppressHydrationWarning
        >
          00%
        </span>
        <span className="atlas-preloader__veil" data-atlas-preloader-veil aria-hidden="true" />
      </div>
      <script
        id="atlas-preloader-start"
        dangerouslySetInnerHTML={{ __html: startPreloaderScript }}
      />
    </>
  );
}
