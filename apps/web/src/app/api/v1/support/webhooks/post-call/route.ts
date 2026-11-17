import { tenantDb } from "@pubcommand/db";
import { agentJson, supportOrganization } from "@/features/support/agent-api";
import { recordGaps } from "@/features/support/gaps";
import { authSecret } from "@/features/support/guard";
import { findGaps, readPostCall } from "../../../../../../../../../modules/support/gaps";
import { decryptSecret, verifyWebhookSignature } from "../../../../../../../../../modules/support/keys";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs post-call webhook → Gaps. URL: /api/v1/support/webhooks/post-call?agent=<profile id>.
 * The body must be signed with that agent's webhook secret (ElevenLabs-Signature header);
 * unsigned or stale calls are refused. Only the unanswered questions are stored, never the transcript.
 */
export async function POST(request: Request) {
  const org = await supportOrganization();
  if (!org) return agentJson(404, { error: "Not found." });
  const agentId = new URL(request.url).searchParams.get("agent") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return agentJson(400, { error: "Add ?agent=<agent id> to the webhook URL." });
  const db = tenantDb(org.id);
  const profile = await db.supportAgentProfile.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true, brandId: true, webhookSecretEnc: true } });
  if (!profile?.webhookSecretEnc) return agentJson(401, { error: "Webhook not set up for this agent." });
  const body = await request.text();
  if (body.length > 5_000_000) return agentJson(413, { error: "Body too large." });
  const ok = verifyWebhookSignature({
    header: request.headers.get("elevenlabs-signature"),
    body,
    secret: decryptSecret(profile.webhookSecretEnc, authSecret()),
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return agentJson(401, { error: "Bad or missing signature." });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return agentJson(400, { error: "The body is not valid JSON." });
  }
  const call = readPostCall(payload);
  const gaps = findGaps(call.transcript);
  const result = gaps.length ? await recordGaps({ organizationId: org.id, brandId: profile.brandId, profileId: profile.id, source: "webhook", conversationId: call.conversationId, gaps }) : { added: 0, repeated: 0 };
  return agentJson(200, { ok: true, gaps: gaps.length, ...result });
}
