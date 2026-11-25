import { hostOrganization } from "@/features/agents/context";
import { revokeToken } from "@/features/agents/oauth";
import { oauthJson, preflight, readForm } from "../shared";

export const dynamic = "force-dynamic";

/** Token revocation (RFC 7009). */
export async function POST(request: Request) {
  const host = await hostOrganization();
  if (host) await revokeToken(host.resolved.id, (await readForm(request)).get("token") ?? "");
  return oauthJson(200, {});
}

export const OPTIONS = preflight;
