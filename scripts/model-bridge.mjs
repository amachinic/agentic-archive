/*
  A real model behind the agent, with no API key.

  Atlas's behaviour lives in prose — the system brief in app/api/agent/route.ts
  and the `next` line each tool result carries. Prose cannot be unit-tested,
  and a scripted fixture only proves the plumbing: it answers however the test
  author decided, which is worth nothing as evidence about what the agent will
  actually do. Testing it needs a model that has never seen the instructions
  and does not know what is being checked.

  This provides one without a key. The route speaks OpenAI chat-completions and
  its endpoint is deliberately overridable (OPENAI_ENDPOINT). The Claude CLI is
  already authenticated on any machine that has it. So: hand the route's OWN
  brief, conversation and tool results to a real model, and translate its
  answer back into the tool_calls shape the route expects.

  It caught three honesty bugs no fixture could have — the agent quoting 55
  candidates at a table showing 19, and two of its siblings.

    node scripts/model-bridge.mjs                     # terminal 1
    ATLAS_AGENT_PROVIDER=openai OPENAI_API_KEY=bridge \
      OPENAI_ENDPOINT=http://localhost:4712/v1/chat/completions \
      OPENAI_MODEL=bridge npm run dev                 # terminal 2
    node scripts/agent-behaviour-test.mjs             # terminal 3

  BRIDGE_MODEL picks the model; a small fast one is the right default, since
  what is on trial is whether the guidance is legible, not how clever the
  reader is. Development only — never part of a build.
*/
import http from "node:http";
import { spawn } from "node:child_process";

const MODEL = process.env.BRIDGE_MODEL || "claude-haiku-4-5-20251001";
const log = [];

/* The prompt carries the route's whole system brief and tool schemas — far
   past what a Windows command line will take, and full of quotes and
   newlines besides. It goes in on stdin. */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    /* shell:true because Windows will not spawn a .cmd shim without one.
       Safe here: the only arguments are these two literals — the prompt,
       which is huge and full of quotes, never touches the command line. */
    const cp = spawn("claude", ["-p", "--model", MODEL], { windowsHide: true, shell: true });
    let out = "", err = "";
    const t = setTimeout(() => { cp.kill(); reject(new Error("model timed out")); }, 180000);
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", (e) => { clearTimeout(t); reject(e); });
    cp.on("close", (code) => {
      clearTimeout(t);
      if (out.trim()) resolve(out);
      else reject(new Error("exit " + code + " " + err.slice(0, 200)));
    });
    cp.stdin.end(prompt);
  });
}

const strip = (s) => {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
};

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const p = JSON.parse(body || "{}");
    const sys = p.messages.find((m) => m.role === "system")?.content ?? "";
    const convo = p.messages.filter((m) => m.role !== "system").map((m) => {
      if (m.role === "tool") return `TOOL RESULT (${m.name ?? "tool"}):\n${m.content}`;
      if (m.role === "assistant" && m.tool_calls?.length) {
        return "YOU CALLED: " + m.tool_calls.map((t) => `${t.function.name}(${t.function.arguments})`).join(", ");
      }
      return `${m.role.toUpperCase()}: ${m.content ?? ""}`;
    }).join("\n\n");

    const tools = (p.tools ?? []).map((t) => `- ${t.function.name}: ${t.function.description}\n  params: ${JSON.stringify(t.function.parameters)}`).join("\n");

    const prompt = [
      "You are the agent described by the SYSTEM brief below. Follow it exactly.",
      "Decide the single next step and answer with ONLY one JSON object, no prose:",
      '  to call a tool:  {"tool":"<name>","args":{...}}',
      '  to reply:        {"say":"<your reply to the human>"}',
      "",
      "=== SYSTEM ===", sys,
      "", "=== TOOLS ===", tools,
      "", "=== CONVERSATION SO FAR ===", convo,
      "", "Your next step, as one JSON object:",
    ].join("\n");

    let out;
    try {
      const raw = await ask(prompt);
      const j = JSON.parse(strip(raw));
      log.push(j.tool ? { call: j.tool, args: j.args } : { say: String(j.say).slice(0, 200) });
      out = j.tool
        ? { choices: [{ message: { role: "assistant", content: null, tool_calls: [
            { id: "c" + log.length, type: "function", function: { name: j.tool, arguments: JSON.stringify(j.args ?? {}) } }] } }] }
        : { choices: [{ message: { role: "assistant", content: String(j.say ?? ""), tool_calls: null } }] };
    } catch (e) {
      console.error("BRIDGE ERROR:", String(e).slice(0, 300));
      log.push({ error: String(e).slice(0, 160) });
      out = { choices: [{ message: { role: "assistant", content: "(bridge failed)", tool_calls: null } }] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
}).listen(4712, () => console.log("bridge → real model (" + MODEL + ") on 4712"));

process.on("SIGINT", () => { console.log(JSON.stringify(log, null, 1)); process.exit(0); });
