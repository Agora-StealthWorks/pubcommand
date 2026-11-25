/**
 * PubCommand's MCP server (Model Context Protocol, Streamable HTTP transport, stateless).
 * One server for every agent: POST /api/mcp on the organization's host. Claude, ChatGPT/OpenAI
 * and other connectors sign in with OAuth (the person logs in with their PubCommand account
 * and approves the agent); Grok/OpenAI/Claude API calls can send an agent API key instead.
 * Responses are plain JSON (no SSE streams): every tool finishes within the request.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "pubcommand", title: "PubCommand", version: "1.0.0" };
export const SERVER_INSTRUCTIONS =
  "You are working inside PubCommand, a publishing platform, as a member of one organization. " +
  "Call whoami first to see your brands and permissions. Use list_ tools to find ids before creating or updating. " +
  "Write post bodies as clean HTML. Publishing may be held for human approval; the tool result says so. " +
  "On the admin console (platform agents): how PubCommand works today is in the Operations Brain's reference notes " +
  "(list_operations_brain with kind reference; start with \"How PubCommand works (start here)\"). Read them before explaining or monitoring the app, " +
  "and record what you learn about how people use it, and anything that changed in the app, with save_operations_note.";

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

export type McpHandlers = {
  listTools: () => unknown[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean } | null>;
};

export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value) && typeof value === "object" && (value as JsonRpcRequest).jsonrpc === "2.0" && typeof (value as JsonRpcRequest).method === "string";
}

function error(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** One JSON-RPC message. Notifications (no id) return null: the HTTP reply is 202 with no body. */
export async function handleMessage(message: unknown, handlers: McpHandlers): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) return error(null, RPC.invalidRequest, "Invalid JSON-RPC request.");
  const isNotification = message.id === undefined;
  if (isNotification) return null;
  const id = message.id ?? null;
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: handlers.listTools() } };
    case "tools/call": {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== "string") return error(id, RPC.invalidParams, "tools/call needs a tool name.");
      if (!args || typeof args !== "object" || Array.isArray(args)) return error(id, RPC.invalidParams, "Tool arguments must be an object.");
      const result = await handlers.callTool(name, args as Record<string, unknown>);
      if (!result) return error(id, RPC.invalidParams, `Unknown tool: ${name}. Call tools/list.`);
      return { jsonrpc: "2.0", id, result };
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return error(id, RPC.methodNotFound, `Method not found: ${message.method}`);
  }
}

/** A tool's return value as MCP content (JSON text plus structured content). */
export function toolContent(data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    ...(typeof data === "object" && data !== null && !Array.isArray(data) ? { structuredContent: data } : {}),
    ...(isError ? { isError: true } : {}),
  };
}
