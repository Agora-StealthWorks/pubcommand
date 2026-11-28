import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * MachineMail (https://machinemail.dev/docs/reference), the AgentMail-compatible /v0 API.
 *
 * - An inbox is one permanent address (no ttl = never expires); `inbox_id` IS the address.
 * - A verified custom domain with catch_all=true creates inboxes on first mail: ISpy uses
 *   that for publisher catch-alls (`<publisher>+anything@<domain>`).
 * - GET /v0/inboxes/{inbox_id}/messages lists messages (newest first; `after`, `ascending`,
 *   `page_token`), hidden ones (spam, quarantine, unauthenticated) only with include_* flags,
 *   which ISpy always sets: competitor mail often lands there.
 * - GET /v0/inboxes/{inbox_id}/messages/{message_id}/raw returns message/rfc822.
 * - Webhooks POST an event envelope signed `X-MachineMail-Signature: t=<unix>,v1=<hex>`,
 *   v1 = HMAC-SHA256(secret, t + "." + raw_body).
 *
 * Env: MACHINEMAIL_API_KEY (mm_live_…), MACHINEMAIL_API_URL (default https://api.machinemail.dev),
 * MACHINEMAIL_DOMAIN (custom inbox domain; default machinemail.dev), MACHINEMAIL_WEBHOOK_SECRET.
 */
export type MachineMailConfig = { apiKey: string; baseUrl: string; domain: string | null; webhookSecret: string | null };

export function machineMailConfig(env: Record<string, string | undefined> = process.env): MachineMailConfig | null {
  const apiKey = env.MACHINEMAIL_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.MACHINEMAIL_API_URL?.trim() || "https://api.machinemail.dev").replace(/\/+$/, "").replace(/\/v0$/, ""),
    domain: env.MACHINEMAIL_DOMAIN?.trim().toLowerCase() || null,
    webhookSecret: env.MACHINEMAIL_WEBHOOK_SECRET?.trim() || null,
  };
}

export type MachineMailMessage = { id: string; inboxId: string; receivedAt: Date | null; meta: Record<string, unknown> };

type Fetch = typeof fetch;

export class MachineMailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(config: MachineMailConfig, path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<Response> {
  const response = await fetchImpl(`${config.baseUrl}/v0${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new MachineMailError(`MachineMail ${response.status}: ${message}`, response.status);
  }
  return response;
}

/** A valid MachineMail username from a name ("TOTD Hotlist" → "totd-hotlist"). */
export function localPartFor(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return /^[a-z0-9]/.test(cleaned) ? cleaned : `ispy-${cleaned || "inbox"}`;
}

/** Create one permanent inbox. A taken address returns 409; the caller picks another name. */
export async function createMachineMailInbox(config: MachineMailConfig, username: string, displayName: string, fetchImpl?: Fetch): Promise<{ id: string; address: string }> {
  const body = JSON.stringify({ username, display_name: displayName.slice(0, 120), client_id: `ispy-${username}${config.domain ? `@${config.domain}` : ""}`, ...(config.domain ? { domain: config.domain } : {}) });
  const res = (await (await call(config, "/inboxes", { method: "POST", body, headers: { "idempotency-key": `ispy-create-${username}-${Date.now()}` } }, fetchImpl)).json()) as { inbox_id?: string; email?: string };
  const address = String(res.inbox_id ?? res.email ?? "").toLowerCase();
  if (!address.includes("@")) throw new Error("MachineMail did not return the inbox address.");
  return { id: address, address };
}

export async function inboxAvailable(config: MachineMailConfig, username: string, fetchImpl?: Fetch): Promise<boolean> {
  const params = new URLSearchParams({ username, ...(config.domain ? { domain: config.domain } : {}) });
  const res = (await (await call(config, `/inboxes/availability?${params.toString()}`, {}, fetchImpl)).json()) as { available?: boolean };
  return res.available === true;
}

const HIDDEN = { include_spam: "true", include_quarantine: "true", include_unauthenticated: "true", include_blocked: "true" };

/** Every inbox address in the MachineMail organization (catch-all ones included). */
export async function listMachineMailInboxes(config: MachineMailConfig, fetchImpl?: Fetch, max = 5000): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "500" });
    if (pageToken) params.set("page_token", pageToken);
    const res = (await (await call(config, `/inboxes?${params.toString()}`, {}, fetchImpl)).json()) as { inboxes?: { inbox_id?: string }[]; next_page_token?: string };
    for (const row of res.inboxes ?? []) if (row.inbox_id) out.push(row.inbox_id.toLowerCase());
    pageToken = res.next_page_token || undefined;
  } while (pageToken && out.length < max);
  return out;
}

/** Messages in one inbox received after `since`, oldest first, across pages (capped). */
export async function listMachineMailMessages(config: MachineMailConfig, inboxId: string, since: Date | null, fetchImpl?: Fetch, max = 500): Promise<MachineMailMessage[]> {
  const out: MachineMailMessage[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100", ascending: "true", ...HIDDEN });
    if (since) params.set("after", since.toISOString());
    if (pageToken) params.set("page_token", pageToken);
    const res = (await (await call(config, `/inboxes/${encodeURIComponent(inboxId)}/messages?${params.toString()}`, {}, fetchImpl)).json()) as { messages?: Record<string, unknown>[]; next_page_token?: string };
    for (const row of res.messages ?? []) {
      if (row.direction && row.direction !== "inbound") continue;
      const id = String(row.message_id ?? "");
      if (id) out.push({ id, inboxId, receivedAt: row.timestamp ? new Date(String(row.timestamp)) : null, meta: messageMeta(row) });
    }
    pageToken = res.next_page_token || undefined;
  } while (pageToken && out.length < max);
  return out;
}

export async function rawMachineMailMessage(config: MachineMailConfig, inboxId: string, messageId: string, fetchImpl?: Fetch): Promise<Uint8Array> {
  const res = await call(config, `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/raw`, { headers: { accept: "message/rfc822" } }, fetchImpl);
  return new Uint8Array(await res.arrayBuffer());
}

/** One message's full object (trust report, authentication results, headers…). */
export async function getMachineMailMessage(config: MachineMailConfig, inboxId: string, messageId: string, fetchImpl?: Fetch): Promise<Record<string, unknown>> {
  return (await (await call(config, `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`, {}, fetchImpl)).json()) as Record<string, unknown>;
}

/** Create the one organization-wide webhook ISpy listens to. Returns its signing secret. */
export async function ensureMachineMailWebhook(config: MachineMailConfig, url: string, fetchImpl?: Fetch): Promise<{ id: string; secret: string | null }> {
  const body = JSON.stringify({ url, event_types: ["message.received", "message.received.spam", "message.received.unauthenticated", "message.received.quarantined"], client_id: "ispy-inbound" });
  const res = (await (await call(config, "/webhooks", { method: "POST", body }, fetchImpl)).json()) as { webhook_id?: string; id?: string; secret?: string };
  return { id: String(res.webhook_id ?? res.id ?? ""), secret: res.secret ?? null };
}

/**
 * What ISpy keeps from MachineMail for each email: everything except the bodies (we have
 * those from the raw MIME). Trust report, labels, authentication results, headers, size…
 */
export function messageMeta(message: Record<string, unknown>): Record<string, unknown> {
  const { text: _t, html: _h, extracted_text: _et, extracted_html: _eh, ...rest } = message;
  void _t;
  void _h;
  void _et;
  void _eh;
  const trust = rest.trust as Record<string, unknown> | undefined;
  if (trust && typeof trust === "object") {
    const { content: _c, ...trustRest } = trust;
    void _c;
    rest.trust = trustRest;
  }
  return { provider: "machinemail", ...rest };
}

/** Spam score and authentication verdicts from a MachineMail message. */
export function providerExtras(meta: Record<string, unknown>): { spamScore: number | null; auth: { spf: string | null; dkim: string | null; dmarc: string | null } | null } {
  const trust = (meta.trust ?? {}) as Record<string, unknown>;
  const classification = (trust.classification ?? {}) as Record<string, unknown>;
  const raw = classification.is_spam ?? classification.spam ?? meta.spam_score;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  const a = meta.authentication_results as Record<string, unknown> | undefined;
  return {
    spamScore: Number.isFinite(n) ? n : null,
    auth: a ? { spf: (a.spf as string) ?? null, dkim: (a.dkim as string) ?? null, dmarc: (a.dmarc as string) ?? null } : null,
  };
}

/** `t=<unix>,v1=<hex>` over `t + "." + body`, within 5 minutes. */
export function verifyWebhookSignature(body: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  const given = String(parts.v1 ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
