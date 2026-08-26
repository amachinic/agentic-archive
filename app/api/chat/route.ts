import { chatAboutImage, VisionError, type ChatMsg } from "@/lib/vision";

export const maxDuration = 300;

/** POST { imageId, messages: [{role:"user"|"assistant", content}] } -> { reply } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { imageId?: number; messages?: ChatMsg[] } | null;
  if (!body?.imageId || !Array.isArray(body.messages) || !body.messages.length) {
    return Response.json({ error: "imageId and messages required" }, { status: 400 });
  }
  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    const reply = await chatAboutImage(Number(body.imageId), messages);
    return Response.json({ reply });
  } catch (e) {
    const status = e instanceof VisionError ? 502 : 500;
    return Response.json({ error: e instanceof Error ? e.message : "chat failed" }, { status });
  }
}
