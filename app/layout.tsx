import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import DialogProvider from "@/components/DialogProvider";
import { collectionTree, libraryStats } from "@/lib/queries";
import { IS_HOSTED_DEMO } from "@/lib/runtime";

export const metadata: Metadata = {
  title: "Image Archivist",
  description: "A multi-agentic dashboard for art direction, visual search, image sorting, curation, and archiving.",
};

// Every route reads the library live; nothing here is static.
export const dynamic = "force-dynamic";

/*
  Theme boots BEFORE first paint: stored choice wins, ?theme= overrides for a
  given load, dark is the house default. Runs inline so there is never a flash
  of the wrong theme; the html element carries suppressHydrationWarning because
  this script mutates it ahead of React.
*/
const themeScript = `(function(){var t;try{t=localStorage.getItem("atlas-theme")}catch(e){}var m=location.search.match(/[?&]theme=(light|dark)/);if(m)t=m[1];if(t!=="light"&&t!=="dark")t="dark";document.documentElement.setAttribute("data-theme",t);})();`;

/*
  First visit of a session to the dashboard routes through the preloader.
  Runs inline before paint so the dashboard never flashes first; the
  preloader marks the session booted before it hands back to "/", so this
  never loops. sessionStorage failures skip the boot rather than trap it.
*/
const bootScript = `(function(){try{if(location.pathname==="/"&&!sessionStorage.getItem("atlas-booted")){location.replace("/preloader.html")}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tree = collectionTree();
  const stats = libraryStats();

  return (
    <html lang="en" suppressHydrationWarning>
      <body data-hosted-demo={IS_HOSTED_DEMO ? "true" : undefined}>
        {/* beforeInteractive: injected into the initial HTML ahead of any
            Next.js code, so both run before first paint — no dashboard
            flash before the boot redirect, no theme flash. */}
        <Script id="atlas-boot" strategy="beforeInteractive">{bootScript}</Script>
        <Script id="atlas-theme" strategy="beforeInteractive">{themeScript}</Script>
        <DialogProvider>
          <div className="app">
            <Sidebar tree={tree} stats={stats} hostedDemo={IS_HOSTED_DEMO} />
            <div className="workspace">{children}</div>
          </div>
        </DialogProvider>
      </body>
    </html>
  );
}
