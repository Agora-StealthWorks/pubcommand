"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { EMAIL_KINDS, offsetFromInput } from "../../../../../modules/funnels/emails";
import { isValidEmail } from "../../../../../modules/funnels/sms";
import { UUID_RE } from "./data";
import { ensureStarterEmails, sendTestEmail } from "./emails";
import { bool, color, pickOne, text, url } from "./form-input";
import { funnelAction, funnelsAction, withMessage, type FunnelsCtx } from "./guard";
import { richFromInput } from "./sanitize";

function audit(ctx: FunnelsCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, metadata });
}

async function ownFunnel(ctx: FunnelsCtx, funnelId: string, back: string) {
  const funnel = UUID_RE.test(funnelId) ? await tenantDb(ctx.resolved.id).funnel.findFirst({ where: { id: funnelId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!funnel) redirect(withMessage("/funnels", "error", "That funnel no longer exists."));
  void back;
  return funnel;
}

const tab = (funnelId: string, name: string, extra = "") => `/funnels/${funnelId}?tab=${name}${extra}`;

// ---------------------------------------------------------------------------
// Invites & reminders

export async function setupStarterEmails(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = tab(funnelId, "emails");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const created = await ensureStarterEmails(ctx.resolved.id, funnel);
  if (created) await audit(ctx, "funnels.emails.created", "funnel", funnel.id, { count: created });
  redirect(withMessage(back, "notice", created ? "Added a confirmation and three reminders. Edit them below." : "This funnel already has emails."));
}

export async function addEmail(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = tab(funnelId, "emails");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const kind = pickOne(formData, "kind", EMAIL_KINDS, "reminder");
  if ((await db.funnelEmail.count({ where: { funnelId: funnel.id } })) >= 20) redirect(withMessage(back, "error", "A funnel can have at most 20 emails."));
  if (kind === "confirm" && (await db.funnelEmail.count({ where: { funnelId: funnel.id, kind: "confirm" } }))) redirect(withMessage(back, "error", "This funnel already has a confirmation email."));
  const email = await db.funnelEmail.create({
    data: {
      organizationId: ctx.resolved.id,
      funnelId: funnel.id,
      kind,
      enabled: false,
      offsetMinutes: kind === "reminder" ? 60 : 0,
      subject: kind === "reminder" ? "Starting soon: {session_title}" : "You're registered for {funnel}",
      bodyHtml: kind === "reminder" ? "<p><strong>{session_title}</strong> starts {date}.</p><p><a href=\"{link}\">Join here</a></p>" : "<p>Thanks for signing up for <strong>{funnel}</strong>.</p>",
    },
  });
  await audit(ctx, "funnels.email.created", "funnel_email", email.id, { kind });
  redirect(`${tab(funnel.id, "emails", `&email=${email.id}`)}#email-${email.id}`);
}

export async function saveEmail(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const emailId = text(formData, "emailId", 40);
  const back = tab(funnelId, "emails", `&email=${emailId}`);
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const email = UUID_RE.test(emailId) ? await db.funnelEmail.findFirst({ where: { id: emailId, funnelId: funnel.id } }) : null;
  if (!email) redirect(withMessage(tab(funnel.id, "emails"), "error", "That email no longer exists."));
  const subject = text(formData, "subject", 250);
  const bodyHtml = richFromInput(String(formData.get("bodyHtml") ?? "").slice(0, 50_000));
  if (!subject || !bodyHtml) redirect(withMessage(back, "error", "An email needs a subject and a message."));
  await db.funnelEmail.updateMany({
    where: { id: email.id },
    data: {
      enabled: bool(formData, "enabled"),
      subject,
      bodyHtml,
      ...(email.kind === "reminder" ? { offsetMinutes: offsetFromInput(formData.get("offsetAmount"), formData.get("offsetUnit")) } : {}),
    },
  });
  await audit(ctx, "funnels.email.updated", "funnel_email", email.id);
  redirect(withMessage(`${back}#email-${email.id}`, "notice", "Email saved."));
}

export async function deleteEmail(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const emailId = text(formData, "emailId", 40);
  const back = tab(funnelId, "emails");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  if (!UUID_RE.test(emailId)) redirect(back);
  const removed = await tenantDb(ctx.resolved.id).funnelEmail.deleteMany({ where: { id: emailId, funnelId: funnel.id } });
  if (removed.count) await audit(ctx, "funnels.email.deleted", "funnel_email", emailId);
  redirect(withMessage(back, "notice", "Email removed."));
}

/** Send one template to the signed-in person, with sample merge values. */
export async function testEmail(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const emailId = text(formData, "emailId", 40);
  const back = tab(funnelId, "emails", `&email=${emailId}`);
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const to = ctx.auth.user.email;
  if (!to || !isValidEmail(to)) redirect(withMessage(back, "error", "Your account has no email address to send a test to."));
  const result = await sendTestEmail({ organizationId: ctx.resolved.id, funnel, emailId, to, origin: ctx.request.origin });
  const message =
    result === "sent"
      ? `Test sent to ${to}.`
      : result === "logged"
        ? "Email is not set up yet (no email service key), so the test was not sent."
        : result === "missing"
          ? "That email no longer exists."
          : "The email service refused the test. Try again later.";
  redirect(withMessage(`${back}#email-${emailId}`, result === "sent" ? "notice" : "error", message));
}

// ---------------------------------------------------------------------------
// SMS opt-in forms

export async function addSmsForm(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = tab(funnelId, "sms");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  if ((await db.funnelSmsForm.count({ where: { funnelId: funnel.id } })) >= 20) redirect(withMessage(back, "error", "A funnel can have at most 20 SMS forms."));
  const theme = funnel.formThemeId ? await db.formTheme.findFirst({ where: { id: funnel.formThemeId, deletedAt: null }, select: { privacyPolicyUrl: true } }) : null;
  const form = await db.funnelSmsForm.create({
    data: {
      organizationId: ctx.resolved.id,
      funnelId: funnel.id,
      name: text(formData, "name", 80) || "SMS signup",
      companyName: funnel.companyName || ctx.brand.name,
      privacyUrl: theme?.privacyPolicyUrl ?? funnel.privacyUrl,
      termsUrl: funnel.termsUrl,
      buttonBg: funnel.accentColor,
    },
  });
  await audit(ctx, "funnels.sms_form.created", "funnel_sms_form", form.id);
  redirect(`${tab(funnel.id, "sms", `&form=${form.id}`)}#sms-${form.id}`);
}

export async function saveSmsForm(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const formId = text(formData, "formId", 40);
  const back = tab(funnelId, "sms", `&form=${formId}`);
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const form = UUID_RE.test(formId) ? await db.funnelSmsForm.findFirst({ where: { id: formId, funnelId: funnel.id } }) : null;
  if (!form) redirect(withMessage(tab(funnel.id, "sms"), "error", "That SMS form no longer exists."));
  await db.funnelSmsForm.updateMany({
    where: { id: form.id },
    data: {
      name: text(formData, "name", 80) || form.name,
      headline: text(formData, "headline", 160),
      introHtml: richFromInput(String(formData.get("introHtml") ?? "").slice(0, 10_000)),
      collectEmail: bool(formData, "collectEmail"),
      phonePlaceholder: text(formData, "phonePlaceholder", 60) || "Mobile number",
      buttonText: text(formData, "buttonText", 40) || "Sign me up",
      successMessage: text(formData, "successMessage", 300) || form.successMessage,
      companyName: text(formData, "companyName", 120),
      programName: text(formData, "programName", 120),
      messageFrequency: text(formData, "messageFrequency", 120) || "Message frequency varies",
      helpContact: text(formData, "helpContact", 120),
      privacyUrl: url(formData, "privacyUrl"),
      termsUrl: url(formData, "termsUrl"),
      customConsent: text(formData, "customConsent", 2000),
      boxBg: color(formData, "boxBg", "#111827"),
      textColor: color(formData, "textColor", "#ffffff"),
      buttonBg: color(formData, "buttonBg", "#1d4ed8"),
      buttonColor: color(formData, "buttonColor", "#ffffff"),
    },
  });
  await audit(ctx, "funnels.sms_form.updated", "funnel_sms_form", form.id);
  redirect(withMessage(`${back}#sms-${form.id}`, "notice", "SMS form saved. Its consent text applies to new sign-ups from now on."));
}

export async function deleteSmsForm(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const formId = text(formData, "formId", 40);
  const back = tab(funnelId, "sms");
  // Deleting a form deletes its opt-in records (PII): admins only.
  const ctx = await funnelsAction(back, "funnels.publish");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const form = UUID_RE.test(formId) ? await db.funnelSmsForm.findFirst({ where: { id: formId, funnelId: funnel.id } }) : null;
  if (!form) redirect(back);
  if (text(formData, "confirm", 120) !== form.name) redirect(withMessage(`${back}&form=${form.id}`, "error", "Type the form name exactly to delete it and its sign-ups."));
  await db.funnelSmsForm.deleteMany({ where: { id: form.id } });
  // Places that showed it fall back to no opt-in.
  await db.funnel.updateMany({ where: { id: funnel.id, optinSmsFormId: form.id }, data: { optinSmsFormId: null, optinMode: "none" } });
  await db.funnelNavItem.updateMany({ where: { funnelId: funnel.id, smsFormId: form.id }, data: { smsFormId: null, optinMode: "none" } });
  await db.funnelDay.updateMany({ where: { funnelId: funnel.id, smsFormId: form.id }, data: { smsFormId: null } });
  await audit(ctx, "funnels.sms_form.deleted", "funnel_sms_form", form.id);
  redirect(withMessage(back, "notice", "SMS form deleted."));
}

// ---------------------------------------------------------------------------
// Delegates (funnels.publish only)

export async function addDelegate(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = tab(funnelId, "delegates");
  const ctx = await funnelsAction(back, "funnels.publish");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const userId = text(formData, "userId", 40);
  const db = tenantDb(ctx.resolved.id);
  const member = UUID_RE.test(userId) ? await db.membership.findFirst({ where: { userId, status: "ACTIVE" }, select: { userId: true } }) : null;
  if (!member) redirect(withMessage(back, "error", "Pick a member of this organization."));
  if (await db.funnelDelegate.count({ where: { funnelId: funnel.id, userId } })) redirect(withMessage(back, "notice", "They are already a delegate."));
  const row = await db.funnelDelegate.create({ data: { organizationId: ctx.resolved.id, funnelId: funnel.id, userId, addedById: ctx.actorId } });
  await audit(ctx, "funnels.delegate.added", "funnel_delegate", row.id, { userId });
  redirect(withMessage(back, "notice", "Delegate added. They can now edit this funnel (not publish it)."));
}

export async function removeDelegate(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = tab(funnelId, "delegates");
  const ctx = await funnelsAction(back, "funnels.publish");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const delegateId = text(formData, "delegateId", 40);
  if (!UUID_RE.test(delegateId)) redirect(back);
  const removed = await tenantDb(ctx.resolved.id).funnelDelegate.deleteMany({ where: { id: delegateId, funnelId: funnel.id } });
  if (removed.count) await audit(ctx, "funnels.delegate.removed", "funnel_delegate", delegateId);
  redirect(withMessage(back, "notice", "Delegate removed."));
}
