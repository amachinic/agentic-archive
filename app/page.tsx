import "./library.css";
import { listTags } from "@/lib/queries";
import GraphView from "@/components/GraphView";

export const dynamic = "force-dynamic";

// The network IS the front door: booting Atlas lands in the field, with the
// full keyterm vocabulary docked beside the prompt HUD.
export default function HomePage() {
  return <GraphView keyterms={listTags()} />;
}
