import { hostOrganization } from "@/features/agents/context";
import { exchangeToken, organizationOfGrant } from "@/features/agents/oauth";
import { currentRequest } from "@/lib/request";
import { oauthJson, preflight, readForm } from "../shared";

export const dynamic = "force-dynamic";

/** OAuth token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export async function POST(request: Request) {
  const form = await readForm(request);
  // The app host (one address for every organization) finds the organization from the code or token.
  const appHost = (await currentRequest()).site.kind === "app";
  const host = appHost ? null : await hostOrganization();
  const organizationId = appHost ? await organizationOfGrant(form) : host && !host.resolved.suspendedAt ? host.resolved.id : null;
  if (!organizationId) return oauthJson(400, appHost ? { error: "invalid_grant", error_description: "The code or token is not valid. Connect again." } : { error: "invalid_request", error_description: "Unknown or suspended organization." });
  const result = await exchangeToken(organizationId, form);
  return result.ok ? oauthJson(200, result.tokens) : oauthJson(400, result.error);
}

export const OPTIONS = preflight;
