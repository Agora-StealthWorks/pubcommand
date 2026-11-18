import { describe, expect, it } from "vitest";
import { aiConfigured, runStructured } from "./index";

describe("runStructured", () => {
  it("reports unavailable without an API key instead of calling the network", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(aiConfigured()).toBe(false);
      await expect(
        runStructured({ system: "s", input: [{ type: "text", text: "hi" }], schema: { type: "object" } }),
      ).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

import { createServer } from "node:http";
import { extractJson, schemaProblem } from "./index";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "tags", "level"],
  properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, level: { type: "string", enum: ["low", "high"] } },
};

describe("schemaProblem / extractJson", () => {
  it("validates the schema subset", () => {
    expect(schemaProblem({ name: "a", tags: ["x"], level: "low" }, SCHEMA)).toBeNull();
    expect(schemaProblem({ name: "a", tags: ["x"] }, SCHEMA)).toBe("answer.level is missing");
    expect(schemaProblem({ name: "a", tags: [1], level: "low" }, SCHEMA)).toBe("answer.tags[0] should be text");
    expect(schemaProblem({ name: "a", tags: [], level: "mid" }, SCHEMA)).toBe("answer.level has an unexpected value");
    expect(schemaProblem({ name: "a", tags: [], level: "low", extra: 1 }, SCHEMA)).toBe("answer.extra is not expected");
    expect(schemaProblem(null, { anyOf: [{ type: "number" }, { type: "null" }] })).toBeNull();
  });
  it("reads JSON wrapped in a fence or a sentence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here it is: {"a":1} done')).toEqual({ a: 1 });
  });
});

describe("runStructured fallback", () => {
  it("retries without JSON mode when the API says the schema is too large", async () => {
    const bodies: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as { output_config?: { format?: unknown } };
        bodies.push(body);
        if (body.output_config?.format) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." } }));
          return;
        }
        const text = '{"name":"Promo","tags":["a"],"level":"high"}';
        const events: [string, unknown][] = [
          ["message_start", { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
          ["message_stop", { type: "message_stop" }],
        ];
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    try {
      const result = await runStructured<{ name: string }>({ system: "s", input: [{ type: "text", text: "hi" }], schema: SCHEMA });
      expect(result).toMatchObject({ status: "ok", data: { name: "Promo", tags: ["a"], level: "high" } });
      expect(bodies).toHaveLength(2);
      expect(JSON.stringify(bodies[1]!.system)).toContain("must match this JSON Schema");
      // Remembered: the next call skips JSON mode straight away.
      await runStructured({ system: "s", input: [{ type: "text", text: "hi" }], schema: SCHEMA });
      expect(bodies).toHaveLength(3);
    } finally {
      server.close();
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = saved.base;
    }
  });
});
