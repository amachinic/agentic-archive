import { chatAboutImage, httpStatus, type ChatMsg } from "@/lib/vision";

export const maxDuration = 300;

/**
 * POST { imageId, messages: [{role:"user"|"assistant", content}] } -> { reply }
 *
 * The ask is checked here, before a model is involved: a blank message or a
 * history that ends on the assistant is a 400, not the 502 it used to be.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { imageId?: unknown; messages?: ChatMsg[] } | null;
  const imageId = typeof body?.imageId === "number" ? body.imageId : Number(body?.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0 || !Array.isArray(body?.messages) || !body.messages.length) {
    return Response.json({ error: "imageId and messages required" }, { status: 400 });
  }
  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "the conversation has to end with something you asked" }, { status: 400 });
  }
  try {
    const reply = await chatAboutImage(imageId, messages);
    return Response.json({ reply });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "chat failed" }, { status: httpStatus(e) });
  }
}
