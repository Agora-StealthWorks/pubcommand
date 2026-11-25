import { hostOrganization } from "@/features/agents/context";
import { authorizationServerMetadata } from "@/features/agents/oauth";
import { oauthJson, preflight } from "../shared";

export const dynamic = "force-dynamic";

/** /.well-known/oauth-authorization-server (rewritten here by the middleware on organization hosts). */
export async function GET() {
  const host = await hostOrganization();
  if (!host) return oauthJson(404, { error: "not_found" });
  return oauthJson(200, authorizationServerMetadata(host.request.origin));
}

export const OPTIONS = preflight;
