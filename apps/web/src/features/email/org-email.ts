import { decryptSecret, encryptSecret, secretHint } from "@pubcommand/auth";
import { chooseEmailRoute, isEmailAddress, renderEmailLayout, resolveSender, type EmailRoute, type SenderFields } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { sendEmail, type EmailResult } from "@/lib/email";
import { emailFrom } from "@/lib/mail";

/**
 * Organization email: an organization's own Resend key (encrypted at rest, never returned to a
 * page), its default sender, and optional senders per brand and per publication. Website member
 * emails go out through sendOrgEmail(). PubCommand's own email (env RESEND_API_KEY + EMAIL_FROM)
 * stays for PubCommand user emails and is only a fallback here.
 *
 * Nothing here logs a key or an email body.
 */

const KEY_PURPOSE = "resend-api-key";
export type SenderOwner = "brand" | "publication";

function authSecret(): string {
  return process.env.AUTH_SECRET ?? "";
}

/** A Resend API key as pasted: "re_" and letters, digits, _ or -. */
export function resendKeyProblem(value: string): string | null {
  const key = value.trim();
  if (!key) return "Paste your Resend API key.";
  if (!/^re_[A-Za-z0-9_-]{8,200}$/.test(key)) return "That does not look like a Resend API key (they start with re_).";
  return null;
}

/** What Settings → Email shows. Never includes the key, only its last four characters. */
export type OrgEmailStatus = {
  connected: boolean;
  keyHint: string | null;
  connectedAt: Date | null;
  defaults: { fromName: string | null; fromAddress: string | null; replyTo: string | null };
};

export async function getOrgEmailStatus(organizationId: string): Promise<OrgEmailStatus> {
  const row = await tenantDb(organizationId).orgEmailSettings.findFirst({
    where: { organizationId },
    select: { resendKeyCipher: true, resendKeyHint: true, keyConnectedAt: true, fromName: true, fromAddress: true, replyTo: true },
  });
  return {
    connected: Boolean(row?.resendKeyCipher),
    keyHint: row?.resendKeyCipher ? row.resendKeyHint : null,
    connectedAt: row?.resendKeyCipher ? row.keyConnectedAt : null,
    defaults: { fromName: row?.fromName ?? null, fromAddress: row?.fromAddress ?? null, replyTo: row?.replyTo ?? null },
  };
}

async function writeSettings(organizationId: string, data: Record<string, unknown>) {
  const db = tenantDb(organizationId);
  const updated = await db.orgEmailSettings.updateMany({ where: { organizationId }, data });
  if (updated.count === 0) await db.orgEmailSettings.create({ data: { organizationId, ...data } });
}

export async function connectResendKey(organizationId: string, actorId: string, key: string): Promise<void> {
  const problem = resendKeyProblem(key);
  if (problem) throw new Error(problem);
  const before = await getOrgEmailStatus(organizationId);
  const plain = key.trim();
  await writeSettings(organizationId, {
    resendKeyCipher: encryptSecret(plain, authSecret(), KEY_PURPOSE),
    resendKeyHint: secretHint(plain),
    keyConnectedAt: new Date(),
    updatedById: actorId,
  });
  await appendOrgAudit(organizationId, {
    actorId,
    action: before.connected ? "email.resend.replaced" : "email.resend.connected",
    targetType: "org_email_settings",
    metadata: { keyHint: secretHint(plain) },
  });
}

export async function removeResendKey(organizationId: string, actorId: string): Promise<void> {
  await writeSettings(organizationId, { resendKeyCipher: null, resendKeyHint: null, keyConnectedAt: null, updatedById: actorId });
  await appendOrgAudit(organizationId, { actorId, action: "email.resend.removed", targetType: "org_email_settings" });
}

/** The organization's decrypted key, for sending only. Null when none is connected (or it cannot be read). */
async function orgApiKey(organizationId: string): Promise<string | null> {
  const row = await tenantDb(organizationId).orgEmailSettings.findFirst({ where: { organizationId }, select: { resendKeyCipher: true } });
  if (!row?.resendKeyCipher) return null;
  const plain = decryptSecret(row.resendKeyCipher, authSecret(), KEY_PURPOSE);
  if (!plain) console.error(`[email] organization ${organizationId}: stored Resend key cannot be decrypted (AUTH_SECRET changed?)`);
  return plain;
}

/** Cleans and checks a sender form. Empty fields are allowed (they fall back to the next layer). */
export function cleanSender(input: { fromName?: string | null; fromAddress?: string | null; replyTo?: string | null }): { value: Required<SenderFields>; error: string | null } {
  const fromName = (input.fromName ?? "").replace(/[\r\n"<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const fromAddress = (input.fromAddress ?? "").trim().toLowerCase() || null;
  const replyTo = (input.replyTo ?? "").trim().toLowerCase() || null;
  if (fromAddress && !isEmailAddress(fromAddress)) return { value: { fromName, fromAddress, replyTo }, error: "Enter a From address like news@yourdomain.com." };
  if (replyTo && !isEmailAddress(replyTo)) return { value: { fromName, fromAddress, replyTo }, error: "Enter a Reply-to address like help@yourdomain.com." };
  return { value: { fromName, fromAddress, replyTo }, error: null };
}

export async function saveDefaultSender(organizationId: string, actorId: string, fields: SenderFields): Promise<void> {
  const { value, error } = cleanSender(fields);
  if (error) throw new Error(error);
  await writeSettings(organizationId, { ...value, updatedById: actorId });
  await appendOrgAudit(organizationId, { actorId, action: "email.sender.saved", targetType: "organization", targetId: organizationId, metadata: { ...value } });
}

export async function getSender(organizationId: string, ownerType: SenderOwner, ownerId: string): Promise<Required<SenderFields>> {
  const row = await tenantDb(organizationId).emailSender.findFirst({
    where: { organizationId, ownerType, ownerId },
    select: { fromName: true, fromAddress: true, replyTo: true },
  });
  return { fromName: row?.fromName ?? null, fromAddress: row?.fromAddress ?? null, replyTo: row?.replyTo ?? null };
}

/** Saves (or clears, when every field is empty) a brand's or publication's sender. The caller checks the owner belongs to the org. */
export async function saveSender(organizationId: string, actorId: string, ownerType: SenderOwner, ownerId: string, fields: SenderFields): Promise<void> {
  const { value, error } = cleanSender(fields);
  if (error) throw new Error(error);
  const db = tenantDb(organizationId);
  const where = { organizationId, ownerType, ownerId };
  if (!value.fromName && !value.fromAddress && !value.replyTo) {
    await db.emailSender.deleteMany({ where });
  } else {
    const updated = await db.emailSender.updateMany({ where, data: { ...value, updatedById: actorId } });
    if (updated.count === 0) await db.emailSender.create({ data: { ...where, ...value, updatedById: actorId } });
  }
  await appendOrgAudit(organizationId, { actorId, action: "email.sender.saved", targetType: ownerType, targetId: ownerId, metadata: { ...value } });
}

/** The key and From header an email from this brand (and publication) would use. */
export async function routeFor(input: { organizationId: string; brandId: string | null; publicationId?: string | null; displayName: string }): Promise<EmailRoute> {
  const [status, brand, publication, key] = await Promise.all([
    getOrgEmailStatus(input.organizationId),
    input.brandId ? getSender(input.organizationId, "brand", input.brandId) : null,
    input.publicationId ? getSender(input.organizationId, "publication", input.publicationId) : null,
    orgApiKey(input.organizationId),
  ]);
  const sender = resolveSender({ publication, brand, organization: status.defaults });
  return chooseEmailRoute({
    orgApiKey: key,
    platformApiKey: process.env.RESEND_API_KEY ?? null,
    platformFrom: emailFrom(),
    sender,
    displayName: input.displayName,
  });
}

/**
 * Sends one email on behalf of an organization (website member emails): the publication's,
 * brand's or organization's sender, through the org's Resend key or, without one, PubCommand's.
 */
export async function sendOrgEmail(input: {
  organizationId: string;
  brandId: string | null;
  publicationId?: string | null;
  displayName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult & { route: EmailRoute["kind"] }> {
  const route = await routeFor(input);
  if (route.kind === "none") {
    console.info(`[email] organization ${input.organizationId}: not sent (no Resend key): "${input.subject}"`);
    return { status: "logged", route: route.kind };
  }
  const result = await sendEmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    from: route.from,
    ...(route.replyTo ? { replyTo: route.replyTo } : {}),
    apiKey: route.apiKey,
  });
  return { ...result, route: route.kind };
}

/** Settings → Email → "Send test email": to the person pressing the button, through the org's own key only. */
export async function sendTestEmail(input: { organizationId: string; organizationName: string; actorId: string; to: string }): Promise<EmailResult> {
  const key = await orgApiKey(input.organizationId);
  if (!key) return { status: "failed", reason: "Connect a Resend API key first." };
  const route = await routeFor({ organizationId: input.organizationId, brandId: null, displayName: input.organizationName });
  const body = renderEmailLayout({
    senderName: input.organizationName,
    heading: "Your email is connected",
    paragraphs: [
      `This test was sent through ${input.organizationName}'s own Resend account.`,
      `It came from ${route.from}. If it landed in spam, check that the domain is verified in Resend.`,
    ],
    button: { label: "Open Resend", url: "https://resend.com/domains" },
  });
  const result = await sendEmail({ to: input.to, subject: `Test email from ${input.organizationName}`, ...body, from: route.from, apiKey: key });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "email.test.sent", targetType: "org_email_settings", metadata: { status: result.status } });
  return result;
}
