import { after } from "next/server";
import { resolveInboxForAddress } from "@/features/ispy/inboxes";
import { ingestAndProcess } from "@/features/ispy/pipeline";
import { getMachineMailMessage, machineMailConfig, messageMeta, providerExtras, rawMachineMailMessage, verifyWebhookSignature } from "@/features/ispy/providers/machinemail";
import { openSecret, readIspySettings } from "@/features/ispy/settings";

/**
 * MachineMail webhook: `message.received*` events for every ISpy inbox. The signature is
 * checked against the webhook's secret; the message is then fetched (raw MIME + full
 * object) and ingested after the response, so MachineMail gets its 200 quickly.
 */
export async function POST(request: Request) {
  const config = machineMailConfig();
  if (!config) return new Response("MachineMail is not configured", { status: 503 });
  const body = await request.text();
  const secret = config.webhookSecret ?? openSecret((await readIspySettings()).machineMailWebhookSecretEnc);
  if (!secret || !verifyWebhookSignature(body, request.headers.get("x-machinemail-signature"), secret)) return new Response("Bad signature", { status: 401 });
  let event: { event_type?: string; message?: { inbox_id?: string; message_id?: string }; data?: { message?: { inbox_id?: string; message_id?: string } } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!event.event_type?.startsWith("message.received")) return Response.json({ ignored: event.event_type ?? "unknown" });
  const message = event.message ?? event.data?.message;
  if (!message?.inbox_id || !message.message_id) return new Response("No message", { status: 400 });
  const inboxAddress = message.inbox_id;
  const messageId = message.message_id;
  after(async () => {
    const inboxId = await resolveInboxForAddress(inboxAddress);
    if (!inboxId) {
      console.warn("[ispy] mail for an inbox ISpy does not know", inboxAddress);
      return;
    }
    const [raw, full] = await Promise.all([rawMachineMailMessage(config, inboxAddress, messageId), getMachineMailMessage(config, inboxAddress, messageId).catch(() => message as Record<string, unknown>)]);
    const meta = messageMeta(full);
    const extras = providerExtras(meta);
    await ingestAndProcess([{ raw, inboxId, providerMessageId: messageId, receivedAt: full.timestamp ? new Date(String(full.timestamp)) : null, providerMeta: meta, spamScore: extras.spamScore, authResults: extras.auth }]);
  });
  return Response.json({ accepted: true });
}
