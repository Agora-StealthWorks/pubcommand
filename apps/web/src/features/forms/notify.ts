import { buildSiteUrl, can } from "@pubcommand/core";
import { loadAccessSubject, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { rootDomain } from "@/lib/auth";
import { sendEmail, type EmailResult } from "@/lib/email";
import { answerLines, asNotifyMode, confirmationAddress, confirmationEmail, MAX_RECIPIENTS, teamEmail } from "../../../../../modules/forms/notify";
import type { AnswerMap } from "../../../../../modules/forms/types";
import { rowToField, toResponseRecord } from "./data";

type Recipient = { email: string; answers: boolean };

/**
 * The team members a form emails, resolved at send time: still active in the
 * organization, still allowed to read this brand's forms. Answers are only
 * included for those who also hold forms.export (individual responses are PII).
 */
export async function resolveRecipients(organizationId: string, brandId: string, userIds: readonly string[], includeAnswers: boolean): Promise<Recipient[]> {
  const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, MAX_RECIPIENTS);
  if (!ids.length) return [];
  const memberships = await tenantDb(organizationId).membership.findMany({
    where: { userId: { in: ids }, status: "ACTIVE" },
    select: { userId: true, user: { select: { email: true } } },
  });
  const recipients: Recipient[] = [];
  for (const membership of memberships) {
    const subject = await loadAccessSubject(organizationId, membership.userId, moduleRegistry.permissionModules());
    if (!subject) continue;
    const scope = { organizationId, brandId };
    if (!subject.entitledModuleIds.includes("forms") || !can(subject, "forms.read", scope)) continue;
    recipients.push({ email: membership.user.email, answers: includeAnswers && can(subject, "forms.export", scope) });
  }
  return recipients;
}

async function orgSlug(organizationId: string): Promise<string | null> {
  const org = await tenantDb(organizationId).organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return org?.slug ?? null;
}

export async function resultsLink(organizationId: string, formId: string): Promise<string> {
  const slug = await orgSlug(organizationId);
  return slug ? buildSiteUrl({ rootDomain: rootDomain(), requestHost: rootDomain(), site: { kind: "org", slug }, pathname: `/forms/${formId}/results` }) : "";
}

export type NotifyOutcome = { sent: number; logged: boolean; failed: number };

/**
 * Email the team about these responses (one email per response for "each",
 * one email for all of them for "digest") and stamp notifiedAt on success.
 * A response is stamped only when every recipient's email went out (or email
 * is not configured, which is recorded as "logged" and not retried forever).
 */
export async function notifyTeam(organizationId: string, formId: string, responseIds: readonly string[], now = new Date()): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { sent: 0, logged: false, failed: 0 };
  if (!responseIds.length) return outcome;
  const db = tenantDb(organizationId);
  const form = await db.form.findFirst({ where: { id: formId, deletedAt: null } });
  if (!form) return outcome;
  const mode = asNotifyMode(form.notifyMode);
  if (mode === "off") return outcome;
  const recipients = await resolveRecipients(organizationId, form.brandId, form.notifyUserIds, form.notifyIncludeAnswers);
  if (!recipients.length) return outcome;
  const [brand, fieldRows, rows] = await Promise.all([
    db.brand.findFirst({ where: { id: form.brandId }, select: { name: true } }),
    db.formField.findMany({ where: { formId }, orderBy: { position: "asc" } }),
    db.formResponse.findMany({
      where: { id: { in: [...responseIds] }, formId, status: "COMPLETE", spamReason: null, notifiedAt: null },
      orderBy: { completedAt: "asc" },
      select: { id: true, status: true, answers: true, startedAt: true, completedAt: true, durationMs: true, lastPageIndex: true, utm: true, spamReason: true },
    }),
  ]);
  if (!rows.length) return outcome;
  const fields = fieldRows.map(rowToField);
  const records = rows.map(toResponseRecord);
  const resultsUrl = await resultsLink(organizationId, formId);
  const batches = mode === "each" ? records.map((record) => [record]) : [records];
  for (const batch of batches) {
    const results: EmailResult[] = [];
    for (const answers of [true, false]) {
      const group = recipients.filter((recipient) => recipient.answers === answers);
      if (!group.length) continue;
      const mail = teamEmail({
        formTitle: form.title,
        brandName: brand?.name ?? "",
        resultsUrl,
        mode,
        items: batch.map((record) => ({ completedAt: record.completedAt ?? now, lines: answers ? answerLines(fields, record.answers) : null })),
      });
      // One message per recipient so team addresses are not shared with each other.
      for (const recipient of group) results.push(await sendEmail({ to: recipient.email, ...mail }));
    }
    if (results.some((result) => result.status === "failed")) {
      outcome.failed += batch.length;
      continue;
    }
    if (results.some((result) => result.status === "logged")) outcome.logged = true;
    await db.formResponse.updateMany({ where: { id: { in: batch.map((record) => record.id) } }, data: { notifiedAt: now } });
    outcome.sent += batch.length;
  }
  if (mode === "digest") await db.form.updateMany({ where: { id: formId }, data: { notifyDigestSentAt: now } });
  return outcome;
}

/** The respondent's own confirmation email, at most once per response. Never includes their answers. */
export async function sendConfirmation(organizationId: string, formId: string, responseId: string): Promise<EmailResult | null> {
  const db = tenantDb(organizationId);
  const form = await db.form.findFirst({ where: { id: formId, deletedAt: null } });
  if (!form?.confirmEmailEnabled || !form.confirmEmailFieldId) return null;
  const response = await db.formResponse.findFirst({ where: { id: responseId, formId, status: "COMPLETE", spamReason: null, confirmationSentAt: null } });
  if (!response) return null;
  const fields = (await db.formField.findMany({ where: { formId }, orderBy: { position: "asc" } })).map(rowToField);
  const to = confirmationAddress(fields, form.confirmEmailFieldId, response.answers as AnswerMap);
  if (!to) return null;
  const brand = await db.brand.findFirst({ where: { id: form.brandId }, select: { name: true } });
  const mail = confirmationEmail({ formTitle: form.title, brandName: brand?.name ?? "", subject: form.confirmEmailSubject, body: form.confirmEmailBody });
  // Stamp first: a confirmation must never be sent twice, even if the send is retried by a reload.
  const claimed = await db.formResponse.updateMany({ where: { id: responseId, confirmationSentAt: null }, data: { confirmationSentAt: new Date() } });
  if (!claimed.count) return null;
  return sendEmail({ to, ...mail });
}
