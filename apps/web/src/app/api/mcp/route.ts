import { authenticateAgent, hostOrganization, logAgentCall, type AgentContext } from "@/features/agents/context";
import { RPC, handleMessage, toolContent, type JsonRpcResponse } from "@/features/agents/mcp";
import { ToolError, findTool, toolsFor } from "@/features/agents/tools";

export const dynamic = "force-dynamic";

/**
 * MCP server for AI agents (see features/agents/mcp.ts). POST only, JSON responses.
 * Unauthenticated calls get 401 with the OAuth protected-resource metadata address, which is
 * how Claude and ChatGPT connectors find the PubCommand sign-in.
 */

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
}

async function unauthorized(error: string, status: number) {
  const host = await hostOrganization();
  const metadata = host ? `${host.request.origin}/.well-known/oauth-protected-resource` : "";
  const challenge: Record<string, string> = status === 401 ? { "www-authenticate": `Bearer realm="pubcommand"${metadata ? `, resource_metadata="${metadata}"` : ""}, error="invalid_token"` } : {};
  return json(status, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: error } }, challenge);
}

async function callTool(ctx: AgentContext, name: string, args: Record<string, unknown>) {
  const tool = findTool(ctx, name);
  if (!tool) return null;
  const started = performance.now();
  try {
    const result = await tool.run(ctx, args);
    await logAgentCall({ organizationId: ctx.organization.id, agentId: ctx.agent.id, tool: name, status: "ok", targetType: result.targetType, targetId: result.targetId, durationMs: performance.now() - started });
    return toolContent(result.data);
  } catch (error) {
    const known = error instanceof ToolError;
    if (!known) console.error("[agents] tool failed", name, error);
    const message = known ? error.message : "Something went wrong on PubCommand's side. Try again.";
    await logAgentCall({ organizationId: ctx.organization.id, agentId: ctx.agent.id, tool: name, status: known && /permission/i.test(message) ? "denied" : "error", message, durationMs: performance.now() - started });
    return toolContent(message, true);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) {
    if (auth.status === 429 && auth.agentId && auth.organizationId) {
      await logAgentCall({ organizationId: auth.organizationId, agentId: auth.agentId, tool: "(rate limited)", status: "rate_limited", durationMs: 0 });
    }
    return unauthorized(auth.error, auth.status);
  }
  const ctx = auth.ctx;
  const text = await request.text();
  if (text.length > 2_000_000) return json(413, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Request too large (2 MB max)." } });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "The body is not valid JSON." } });
  }
  const handlers = { listTools: () => toolsFor(ctx), callTool: (name: string, args: Record<string, unknown>) => callTool(ctx, name, args) };
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return json(400, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Send 1 to 20 messages." } });
    const replies: JsonRpcResponse[] = [];
    for (const message of body) {
      const reply = await handleMessage(message, handlers);
      if (reply) replies.push(reply);
    }
    return replies.length ? json(200, replies) : json(202, null);
  }
  const reply = await handleMessage(body, handlers);
  return reply ? json(200, reply) : json(202, null);
}

/** No server-sent event stream: this server answers every request directly. */
export async function GET() {
  return new Response("Method not allowed. POST JSON-RPC messages to this address.", { status: 405, headers: { allow: "POST", "content-type": "text/plain; charset=utf-8" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
