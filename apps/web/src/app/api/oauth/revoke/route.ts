import { hostOrganization } from "@/features/agents/context";
import { organizationOfGrant, revokeToken } from "@/features/agents/oauth";
import { currentRequest } from "@/lib/request";
import { oauthJson, preflight, readForm } from "../shared";

export const dynamic = "force-dynamic";

/** Token revocation (RFC 7009). */
export async function POST(request: Request) {
  const form = await readForm(request);
  const appHost = (await currentRequest()).site.kind === "app";
  const host = appHost ? null : await hostOrganization();
  const organizationId = appHost ? await organizationOfGrant(form) : (host?.resolved.id ?? null);
  if (organizationId) await revokeToken(organizationId, form.get("token") ?? "");
  return oauthJson(200, {});
}

export const OPTIONS = preflight;
