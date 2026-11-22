import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { historyMessages, runChat, type ChatTool } from "./index";

/** Each request pops the next scripted reply: text, or a tool call with its JSON input. */
type Scripted = { text?: string; tool?: { name: string; input: unknown } };
let script: Scripted[] = [];
const bodies: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[] = [];
let server: Server;
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      const next = script.shift() ?? { text: "done" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }));
      let index = 0;
      if (next.text) {
        res.write(sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }));
        res.write(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: next.text } }));
        res.write(sse("content_block_stop", { type: "content_block_stop", index }));
        index += 1;
      }
      if (next.tool) {
        res.write(sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `t${bodies.length}`, name: next.tool.name, input: {} } }));
        res.write(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(next.tool.input) } }));
        res.write(sse("content_block_stop", { type: "content_block_stop", index }));
      }
      res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: next.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } }));
      res.end(sse("message_stop", { type: "message_stop" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = saved.base;
});

beforeEach(() => {
  script = [];
  bodies.length = 0;
});

const search: ChatTool = {
  name: "search",
  description: "Search notes",
  inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
  run: async (input) => `found notes about ${String(input.query)}`,
};

describe("runChat", () => {
  it("runs a tool, hands the result back and returns the answer", async () => {
    script = [{ text: "Let me look.", tool: { name: "search", input: { query: "webinars" } } }, { text: "Webinars convert best." }];
    const seen: string[] = [];
    const result = await runChat({ system: "s", history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }], input: [{ type: "text", text: "what works?" }], tools: [search], onText: (t) => void seen.push(t) });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.text).toBe("Let me look.\n\nWebinars convert best.");
    expect(result.activity).toEqual([{ tool: "search", input: { query: "webinars" }, ok: true, result: "found notes about webinars" }]);
    expect(result.usage.outputTokens).toBe(14);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const toolResult = JSON.stringify(bodies[1]!.messages.at(-1)!.content);
    expect(toolResult).toContain("found notes about webinars");
    expect(JSON.stringify(bodies[0]!.tools)).toContain("eager_input_streaming");
  });

  it("returns invalid tool input to the model as an error instead of running the tool", async () => {
    let ran = false;
    const tool = { ...search, run: async () => ((ran = true), "x") };
    script = [{ tool: { name: "search", input: { wrong: 1 } } }, { text: "Sorry." }];
    const result = await runChat({ system: "s", history: [], input: [{ type: "text", text: "go" }], tools: [tool] });
    expect(ran).toBe(false);
    expect(result.status).toBe("ok");
    expect(JSON.stringify(bodies[1]!.messages.at(-1)!.content)).toContain("INVALID_INPUT");
  });

  it("is unavailable without a key", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(runChat({ system: "s", history: [], input: [{ type: "text", text: "hi" }], tools: [] })).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe("historyMessages", () => {
  it("merges neighbours, drops empties and starts with the user", () => {
    expect(
      historyMessages([
        { role: "assistant", content: "hello" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: " " },
        { role: "assistant", content: "c" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });
});
