import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { streamText } from "./index";

type Reply = { chunks: string[]; stop: string; delayMs?: number };
let reply: Reply = { chunks: [], stop: "end_turn" };
const bodies: Record<string, unknown>[] = [];
let server: Server;
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse("message_start", { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }));
      res.write(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
      for (const text of reply.chunks) {
        res.write(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
        if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      }
      res.write(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
      res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: 42 } }));
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

describe("streamText", () => {
  it("reports unavailable without an API key", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(streamText({ system: "s", input: [{ type: "text", text: "hi" }] })).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("streams text, reports progress, caches the system prompt and sends fallbacks", async () => {
    reply = { chunks: ["<<HEAD", "LINE>>\nHi", "\n<</HEADLINE>>"], stop: "end_turn", delayMs: 5 };
    const seen: string[] = [];
    const result = await streamText({ system: "stable", context: "per promo", input: [{ type: "text", text: "copy" }], onText: (t) => void seen.push(t) });
    expect(result).toMatchObject({ status: "ok", text: "<<HEADLINE>>\nHi\n<</HEADLINE>>", usage: { model: "claude-opus-5-5", outputTokens: 42 } });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBe("<<HEADLINE>>\nHi\n<</HEADLINE>>");
    const body = bodies.at(-1)!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config).toMatchObject({ effort: "high" });
    expect(body.stream).toBe(true);
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system[0]).toMatchObject({ text: "stable", cache_control: { type: "ephemeral" } });
    expect(system[1]).toEqual({ type: "text", text: "per promo" });
  });

  it("returns the partial text when the answer hits max_tokens", async () => {
    reply = { chunks: ["<<HEADLINE>>\nHalf"], stop: "max_tokens" };
    await expect(streamText({ system: "s", input: [{ type: "text", text: "x" }] })).resolves.toMatchObject({ status: "truncated", text: "<<HEADLINE>>\nHalf" });
  });

  it("fails on a refusal", async () => {
    reply = { chunks: ["I can't"], stop: "refusal" };
    await expect(streamText({ system: "s", input: [{ type: "text", text: "x" }] })).resolves.toMatchObject({ status: "failed", reason: "The AI declined to analyze this document." });
  });

  it("never lets a throwing progress handler break the stream", async () => {
    reply = { chunks: ["a", "b"], stop: "end_turn" };
    const result = await streamText({ system: "s", input: [{ type: "text", text: "x" }], onText: () => { throw new Error("boom"); } });
    expect(result).toMatchObject({ status: "ok", text: "ab" });
  });
});
