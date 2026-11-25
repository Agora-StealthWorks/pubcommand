import { agentHostOrigin } from "@/features/agents/context";
import { registerClient } from "@/features/agents/oauth";
import { oauthJson, preflight } from "../shared";

export const dynamic = "force-dynamic";

/** Dynamic client registration (RFC 7591) for MCP connectors. */
export async function POST(request: Request) {
  const origin = await agentHostOrigin();
  if (!origin) return oauthJson(404, { error: "not_found" });
  let body: unknown;
  try {
    body = JSON.parse((await request.text()).slice(0, 20_000));
  } catch {
    return oauthJson(400, { error: "invalid_client_metadata", error_description: "Send JSON." });
  }
  const result = await registerClient(body);
  return result.ok ? oauthJson(201, result.client) : oauthJson(400, result.error);
}

export const OPTIONS = preflight;
