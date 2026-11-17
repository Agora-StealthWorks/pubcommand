import { rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { createHmac } from "node:crypto";
import { rootDomain } from "@/lib/auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import { emailFrom } from "@/lib/mail";
import { defaultEmails, dueReminders, mergeValues, reminderSessions, renderEmail, sendKey, unsubscribeToken, type ReminderSession } from "../../../../../modules/funnels/emails";
import { dayLabel, emailConsent, funnelBranding, orgTimezone, type FunnelRow } from "./data";
import { orgPublicUrl } from "./guard";
import { sanitizeRich } from "./sanitize";

/**
 * Invites and reminders. The registration confirmation goes out right after an
 * email opt-in (from the opt-in route); reminders go out from the
 * `funnels.reminders` job. Every send is recorded in funnel_email_sends under a
 * unique key, so nothing is ever sent twice, and unsubscribed opt-ins are
 * never emailed. Without RESEND_API_KEY nothing is sent ("logged").
 */

/** The unsubscribe signing key, derived from AUTH_SECRET (never AUTH_SECRET itself). */
export function unsubscribeSecret(): string {
  const base = process.env.FUNNELS_COOKIE_SECRET || process.env.AUTH_SECRET || "";
  return base ? createHmac("sha256", base).update("pubcommand:funnels:unsubscribe:v1").digest("base64url") : "";
}

export function unsubscribeUrl(origin: string, funnelSlug: string, optinId: string): string {
  const token = unsubscribeToken(optinId, unsubscribeSecret());
  return `${origin}/l/${funnelSlug}/unsubscribe?o=${optinId}&t=${token}`;
}

/** "Name <address>" from the platform sender, with the funnel's sender name. */
function fromHeader(name: string): string | undefined {
  const clean = name.replace(/["<>\r\n]/g, "").trim().slice(0, 80);
  if (!clean) return undefined;
  const base = emailFrom();
  const address = /<([^>]+)>/.exec(base)?.[1] ?? (base.includes("@") ? base.trim() : null);
  return address ? `"${clean}" <${address}>` : undefined;
}

async function liveDays(organizationId: string, funnelId: string) {
  const days = await tenantDb(organizationId).funnelDay.findMany({ where: { funnelId }, orderBy: { position: "asc" } });
  return days.map((day) => ({ id: day.id, position: day.position, label: dayLabel(day), title: day.title, isLive: day.isLive, liveStartAt: day.liveStartAt, liveUrl: day.liveUrl, liveOverride: day.liveOverride }));
}

export async function funnelSessions(organizationId: string, funnel: FunnelRow): Promise<ReminderSession[]> {
  return reminderSessions(funnel, await liveDays(organizationId, funnel.id));
}

/** Create the starter confirmation and reminders for a funnel that has no emails yet. */
export async function ensureStarterEmails(organizationId: string, funnel: FunnelRow): Promise<number> {
  const db = tenantDb(organizationId);
  if (await db.funnelEmail.count({ where: { funnelId: funnel.id } })) return 0;
  const starters = defaultEmails(funnel.mode === "live");
  for (const email of starters) await db.funnelEmail.create({ data: { organizationId, funnelId: funnel.id, ...email } });
  return starters.length;
}

async function record(organizationId: string, data: { funnelId: string; emailId: string; optinId: string; sessionKey: string }): Promise<boolean> {
  // Claim the send first: the unique key means a second worker (or a retry) gets nothing to do.
  try {
    await tenantDb(organizationId).funnelEmailSend.create({ data: { organizationId, ...data, status: "pending" } });
    return true;
  } catch {
    return false;
  }
}

/** Record the outcome. A failed send gives its claim back, so the next run retries it (inside the reminder's window). */
async function finish(organizationId: string, key: { emailId: string; optinId: string; sessionKey: string }, status: "sent" | "logged" | "failed", error?: string) {
  const db = tenantDb(organizationId);
  if (status === "failed") {
    console.warn("[funnels] email failed, will retry", key.emailId, error);
    await db.funnelEmailSend.deleteMany({ where: key });
    return;
  }
  await db.funnelEmailSend.updateMany({ where: key, data: { status } });
}

type Prepared = { subject: string; html: string; text: string };

function prepare(template: { subject: string; bodyHtml: string }, values: Parameters<typeof renderEmail>[1]): Prepared {
  return renderEmail({ subject: template.subject, bodyHtml: sanitizeRich(template.bodyHtml) }, values);
}

/**
 * The registration confirmation for one email opt-in (called after the
 * response). `origin` is the host the visitor signed up on, so links work on a
 * custom domain too.
 */
export async function sendConfirmation(input: { organizationId: string; funnelId: string; optinId: string; origin: string; base: string }): Promise<"sent" | "logged" | "failed" | "skipped"> {
  const db = tenantDb(input.organizationId);
  const [funnel, optin, template] = await Promise.all([
    db.funnel.findFirst({ where: { id: input.funnelId, deletedAt: null } }),
    db.funnelOptin.findFirst({ where: { id: input.optinId, funnelId: input.funnelId } }),
    db.funnelEmail.findFirst({ where: { funnelId: input.funnelId, kind: "confirm", enabled: true }, orderBy: { createdAt: "asc" } }),
  ]);
  if (!funnel || !optin || optin.unsubscribedAt || !template) return "skipped";
  const key = { emailId: template.id, optinId: optin.id, sessionKey: "" };
  if (!(await record(input.organizationId, { funnelId: funnel.id, ...key }))) return "skipped";
  const [timeZone, branding, sessions] = await Promise.all([orgTimezone(input.organizationId), funnelBranding(input.organizationId, funnel, ""), funnelSessions(input.organizationId, funnel)]);
  const next = sessions.find((session) => session.startAt > new Date()) ?? null;
  const pageUrl = `${input.origin}${input.base || "/"}`;
  const email = prepare(template, mergeValues({ funnelName: funnel.name, company: branding.companyName, email: optin.email, session: next, timeZone, now: new Date(), pageUrl, unsubscribeUrl: unsubscribeUrl(input.origin, funnel.slug, optin.id) }));
  const result = await sendEmail({ to: optin.email, ...email, from: fromHeader(funnel.emailFromName || branding.companyName), replyTo: funnel.emailReplyTo ?? undefined });
  await finish(input.organizationId, key, result.status, result.status === "failed" ? result.reason : undefined);
  return result.status;
}

/** A test send of one template to the person editing it (not recorded, not an opt-in). */
export async function sendTestEmail(input: { organizationId: string; funnel: FunnelRow; emailId: string; to: string; origin: string }): Promise<"sent" | "logged" | "failed" | "missing"> {
  const db = tenantDb(input.organizationId);
  const template = await db.funnelEmail.findFirst({ where: { id: input.emailId, funnelId: input.funnel.id } });
  if (!template) return "missing";
  const [timeZone, branding, sessions] = await Promise.all([orgTimezone(input.organizationId), funnelBranding(input.organizationId, input.funnel, ""), funnelSessions(input.organizationId, input.funnel)]);
  const session = template.kind === "reminder" ? sessions.find((item) => item.startAt > new Date()) ?? sessions[0] ?? null : null;
  const base = `${input.origin}/l/${input.funnel.slug}`;
  const values = mergeValues({ funnelName: input.funnel.name, company: branding.companyName, email: input.to, session, timeZone, now: session ? new Date(session.startAt.getTime() - template.offsetMinutes * 60_000) : new Date(), pageUrl: `${base}${session?.path ?? ""}`, unsubscribeUrl: `${base}/unsubscribe?test=1` });
  const email = prepare(template, values);
  const result = await sendEmail({ to: input.to, ...email, subject: `[Test] ${email.subject}`, from: fromHeader(input.funnel.emailFromName || branding.companyName), replyTo: input.funnel.emailReplyTo ?? undefined });
  return result.status;
}

/** Counts per template for the Emails tab: sent, and logged (email was not set up at the time). */
export async function emailSendCounts(organizationId: string, funnelId: string) {
  const rows = await tenantDb(organizationId).funnelEmailSend.findMany({ where: { funnelId }, select: { emailId: true, status: true }, take: 500_000 });
  const counts = new Map<string, { sent: number; logged: number }>();
  for (const row of rows) {
    const entry = counts.get(row.emailId) ?? { sent: 0, logged: 0 };
    if (row.status === "sent") entry.sent += 1;
    else if (row.status === "logged") entry.logged += 1;
    counts.set(row.emailId, entry);
  }
  return counts;
}

/**
 * One pass of the reminders job for one organization: every published funnel
 * with enabled reminders, every session, every opt-in that is due.
 */
export async function runRemindersForOrg(organizationId: string, orgSlug: string, now: Date, limit: number): Promise<{ funnels: number; due: number; sent: number; logged: number; failed: number }> {
  const db = tenantDb(organizationId);
  const totals = { funnels: 0, due: 0, sent: 0, logged: 0, failed: 0 };
  const reminders = await db.funnelEmail.findMany({ where: { kind: "reminder", enabled: true }, select: { id: true, funnelId: true, enabled: true, offsetMinutes: true, subject: true, bodyHtml: true } });
  if (!reminders.length) return totals;
  const funnelIds = [...new Set(reminders.map((row) => row.funnelId))];
  const funnels = await db.funnel.findMany({ where: { id: { in: funnelIds }, status: "published", deletedAt: null } });
  if (!funnels.length) return totals;
  const timeZone = await orgTimezone(organizationId);
  const origin = orgPublicUrl(rootDomain(), orgSlug, "/").replace(/\/(\?.*)?$/, "");
  for (const funnel of funnels) {
    const sessions = await funnelSessions(organizationId, funnel);
    if (!sessions.length) continue;
    totals.funnels += 1;
    const mine = reminders.filter((row) => row.funnelId === funnel.id);
    const optins = await db.funnelOptin.findMany({ where: { funnelId: funnel.id, unsubscribedAt: null }, select: { id: true, email: true, createdAt: true, unsubscribedAt: true } });
    if (!optins.length) continue;
    const sent = await db.funnelEmailSend.findMany({ where: { funnelId: funnel.id, emailId: { in: mine.map((row) => row.id) } }, select: { emailId: true, optinId: true, sessionKey: true } });
    const due = dueReminders({ reminders: mine, sessions, optins, sent: new Set(sent.map((row) => sendKey(row.emailId, row.optinId, row.sessionKey))), now });
    if (!due.length) continue;
    totals.due += due.length;
    const branding = await funnelBranding(organizationId, funnel, "");
    const byId = new Map(optins.map((optin) => [optin.id, optin]));
    const templates = new Map(mine.map((row) => [row.id, row]));
    for (const item of due) {
      if (totals.sent + totals.logged + totals.failed >= limit) return totals;
      const optin = byId.get(item.optinId)!;
      const template = templates.get(item.emailId)!;
      const key = { emailId: item.emailId, optinId: item.optinId, sessionKey: item.sessionKey };
      if (!(await record(organizationId, { funnelId: funnel.id, ...key }))) continue;
      const pageUrl = `${origin}/l/${funnel.slug}${item.session.path}`;
      const email = prepare(template, mergeValues({ funnelName: funnel.name, company: branding.companyName, email: optin.email, session: item.session, timeZone, now, pageUrl, unsubscribeUrl: unsubscribeUrl(origin, funnel.slug, optin.id) }));
      const result = await sendEmail({ to: optin.email, ...email, from: fromHeader(funnel.emailFromName || branding.companyName), replyTo: funnel.emailReplyTo ?? undefined });
      await finish(organizationId, key, result.status, result.status === "failed" ? result.reason : undefined);
      totals[result.status] += 1;
    }
  }
  return totals;
}

/** Every organization with funnel reminders (ids and slugs only). */
export async function organizationsWithReminders(): Promise<{ id: string; slug: string }[]> {
  return rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true, slug: true } });
}

/** Mark an opt-in unsubscribed (idempotent). */
export async function unsubscribeOptin(organizationId: string, funnelId: string, optinId: string): Promise<boolean> {
  const updated = await tenantDb(organizationId).funnelOptin.updateMany({ where: { id: optinId, funnelId, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  return updated.count > 0;
}

export { emailConfigured, emailConsent };
export type EmailUpdate = Prisma.FunnelEmailUpdateManyMutationInput;
