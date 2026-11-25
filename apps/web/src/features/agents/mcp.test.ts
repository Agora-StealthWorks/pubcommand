import { describe, expect, it } from "vitest";
import { RPC, handleMessage, negotiateVersion, toolContent, type McpHandlers } from "./mcp";

const handlers: McpHandlers = {
  listTools: () => [{ name: "whoami" }],
  callTool: async (name) => (name === "whoami" ? toolContent({ agent: "Stephen's Claude" }) : null),
};

describe("MCP JSON-RPC", () => {
  it("initializes with a supported protocol version", async () => {
    const reply = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude" } } }, handlers);
    expect(reply?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pubcommand" } });
  });

  it("falls back to the newest version it knows", () => {
    expect(negotiateVersion("1999-01-01")).toBe("2025-11-25");
    expect(negotiateVersion(undefined)).toBe("2025-11-25");
  });

  it("answers notifications with nothing", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, handlers)).toBeNull();
  });

  it("lists and calls tools", async () => {
    expect((await handleMessage({ jsonrpc: "2.0", id: "a", method: "tools/list" }, handlers))?.result).toEqual({ tools: [{ name: "whoami" }] });
    const call = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }, handlers);
    expect(call?.result).toMatchObject({ structuredContent: { agent: "Stephen's Claude" } });
  });

  it("rejects unknown tools, bad arguments, unknown methods and junk", async () => {
    expect((await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "drop_tables" } }, handlers))?.error?.code).toBe(RPC.invalidParams);
    expect((await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "whoami", arguments: [1] } }, handlers))?.error?.code).toBe(RPC.invalidParams);
    expect((await handleMessage({ jsonrpc: "2.0", id: 5, method: "sampling/createMessage" }, handlers))?.error?.code).toBe(RPC.methodNotFound);
    expect((await handleMessage({ id: 6, method: "ping" }, handlers))?.error?.code).toBe(RPC.invalidRequest);
  });

  it("marks tool errors", () => {
    expect(toolContent("No such post.", true)).toEqual({ content: [{ type: "text", text: "No such post." }], isError: true });
  });
});
