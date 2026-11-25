import { hostOrganization } from "@/features/agents/context";
import { exchangeToken } from "@/features/agents/oauth";
import { oauthJson, preflight, readForm } from "../shared";

export const dynamic = "force-dynamic";

/** OAuth token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export async function POST(request: Request) {
  const host = await hostOrganization();
  if (!host || host.resolved.suspendedAt) return oauthJson(400, { error: "invalid_request", error_description: "Unknown or suspended organization." });
  const result = await exchangeToken(host.resolved.id, await readForm(request));
  return result.ok ? oauthJson(200, result.tokens) : oauthJson(400, result.error);
}

export const OPTIONS = preflight;
