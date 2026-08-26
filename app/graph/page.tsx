import { redirect } from "next/navigation";

// The network moved to the front door; old links follow it home.
export default function GraphPage() {
  redirect("/");
}
