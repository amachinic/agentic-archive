import "../../library.css";
import ConnectionsView from "@/components/ConnectionsView";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Connections</h1>
          <span className="pill pill--static">sources Atlas may look at</span>
        </div>
        <div className="topbar__spacer" />
        <span className="mono-xs">look outside · rank against yours · one door writes</span>
      </header>
      <div className="work">
        <main className="pane" tabIndex={-1} style={{ overflowY: "auto" }}>
          <ConnectionsView />
        </main>
      </div>
    </>
  );
}
