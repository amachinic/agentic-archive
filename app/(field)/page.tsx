import "../library.css";
import { listTags, graphData } from "@/lib/queries";
import { IS_HOSTED_READ_ONLY } from "@/lib/runtime";
import GraphView, { FIELD_DEFAULTS } from "@/components/GraphView";

export const dynamic = "force-dynamic";

// The network IS the front door: booting Atlas lands in the field, with the
// full keyterm vocabulary docked beside the prompt HUD.
//
// The field comes WITH the page. It used to be fetched from /api/graph after
// hydration, which left the canvas empty for the length of that round trip:
// measured on the deployed site, cards first appeared 5.5s in, and the
// skeletons the loader draws were never seen because there were no cards to
// draw them on. Rendering it here costs about 55KB gzipped in the document
// and saves the whole round trip, so the first paint already has a field on
// it. Moving the tune controls still refetches.
export default function HomePage() {
  const { min, mode, edgesPerNode } = FIELD_DEFAULTS;
  const g = graphData(min, edgesPerNode, undefined, mode);
  /* node:sqlite hands back rows with a NULL PROTOTYPE, and React will not send
     those across the server/client boundary: "Only plain objects, and a few
     built-ins, can be passed to Client Components". The round trip through
     JSON is what makes them plain. It also drops `membership`, which the field
     never reads, so none of it is paid for in the document. */
  const initialGraph = JSON.parse(JSON.stringify({ nodes: g.nodes, edges: g.edges }));
  /* On the hosted archive every write and every model call is refused by the
     middleware. The field still works: it is all client-side. Handing the flag
     down means the panel can say which half is live rather than inviting a
     prompt and answering it with a 403. */
  return <GraphView keyterms={listTags()} initialGraph={initialGraph} readOnly={IS_HOSTED_READ_ONLY} />;
}
