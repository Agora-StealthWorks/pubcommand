import { agentHostOrigin } from "@/features/agents/context";
import { protectedResourceMetadata } from "@/features/agents/oauth";
import { oauthJson, preflight } from "../shared";

export const dynamic = "force-dynamic";

/** /.well-known/oauth-protected-resource[/api/mcp] (rewritten here by the middleware on organization hosts). */
export async function GET() {
  const origin = await agentHostOrigin();
  if (!origin) return oauthJson(404, { error: "not_found" });
  return oauthJson(200, protectedResourceMetadata(origin));
}

export const OPTIONS = preflight;
