import "../library.css";
import AgentsView from "@/components/AgentsView";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <>
      <header className="topbar">
        <div className="topbar__lede">
          <h1 className="topbar__title">Agents</h1>
          <span className="pill pill--static">one agent · three archetypes</span>
        </div>
        <div className="topbar__spacer" />
        <span className="mono-xs">agents want · you decide · one door writes</span>
      </header>
      <div className="work">
        <main className="pane" tabIndex={-1} style={{ overflowY: "auto" }}>
          <AgentsView />
        </main>
      </div>
    </>
  );
}
