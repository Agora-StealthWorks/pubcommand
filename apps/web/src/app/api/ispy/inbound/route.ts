import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { resolveInboxForAddress } from "@/features/ispy/inboxes";
import { ingestAndProcess } from "@/features/ispy/pipeline";

/**
 * Generic inbound: any inbound-mail service (Cloudflare Email Workers, Postmark, SES…)
 * POSTs the raw message (message/rfc822) with `Authorization: Bearer $ISPY_INBOUND_SECRET`
 * and the receiving address in `?to=` or the `X-Original-To` header.
 */
export async function POST(request: Request) {
  const expected = process.env.ISPY_INBOUND_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected.length < 16 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return new Response("Unauthorized", { status: 401 });
  const to = new URL(request.url).searchParams.get("to") ?? request.headers.get("x-original-to") ?? "";
  if (!to.includes("@")) return new Response("Missing ?to= address", { status: 400 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!raw.byteLength || raw.byteLength > 15 * 1024 * 1024) return new Response("Empty or too large", { status: 413 });
  const inboxId = await resolveInboxForAddress(to);
  if (!inboxId) return new Response("Unknown inbox", { status: 404 });
  after(() => ingestAndProcess([{ raw, inboxId, providerMeta: { provider: "inbound", to } }]).then(() => undefined));
  return Response.json({ accepted: true });
}
