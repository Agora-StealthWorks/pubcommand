"use server";

import {
  isSystemEmailKey,
  PLATFORM_PERMISSIONS,
  platformCan,
  renderSystemEmail,
  SYSTEM_EMAILS,
  systemEmailCopyProblem,
  type SystemEmailCopy,
  type SystemEmailKey,
} from "@pubcommand/core";
import { appendPlatformAudit } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { readSession, readStaff, staffReady } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { currentRequest } from "@/lib/request";
import { saveSystemEmailCopy, SYSTEM_EMAIL_COPY_KEY } from "@/features/system-emails/store";

/** Admin → Emails: edit, reset and test PubCommand's own system emails. Super admin only. */

async function emailStaff() {
  const auth = await readSession();
  if (!auth.user || !auth.session?.mfaVerified) redirect("/2fa");
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session) || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageSystemEmails)) {
    redirect("/?error=You do not have permission.");
  }
  return { auth, staff };
}

function back(key: string, flash: { error?: string; notice?: string }): never {
  const params = new URLSearchParams({ email: key });
  if (flash.error) params.set("error", flash.error);
  if (flash.notice) params.set("notice", flash.notice);
  redirect(`/emails?${params.toString()}`);
}

function readKey(formData: FormData): SystemEmailKey {
  const key = String(formData.get("key") ?? "");
  if (!isSystemEmailKey(key)) redirect("/emails?error=Unknown email.");
  return key;
}

function readCopy(formData: FormData): SystemEmailCopy {
  const field = (name: string) => String(formData.get(name) ?? "").replace(/\r\n?/g, "\n");
  return {
    subject: field("subject").trim(),
    heading: field("heading").trim(),
    body: field("body").trim(),
    buttonLabel: field("buttonLabel").trim(),
    footnote: field("footnote").trim(),
  };
}

export async function saveSystemEmail(formData: FormData) {
  const { auth } = await emailStaff();
  const key = readKey(formData);
  const copy = readCopy(formData);
  const problem = systemEmailCopyProblem(key, copy);
  if (problem) back(key, { error: problem });
  await saveSystemEmailCopy({ key, copy, actorId: auth.user.id });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "system_email.copy.updated",
    targetType: "platform_setting",
    targetId: SYSTEM_EMAIL_COPY_KEY,
    metadata: { email: key },
  });
  back(key, { notice: `${SYSTEM_EMAILS[key].name} saved. It goes out with this copy from now on.` });
}

export async function resetSystemEmail(formData: FormData) {
  const { auth } = await emailStaff();
  const key = readKey(formData);
  await saveSystemEmailCopy({ key, copy: null, actorId: auth.user.id });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "system_email.copy.reset",
    targetType: "platform_setting",
    targetId: SYSTEM_EMAIL_COPY_KEY,
    metadata: { email: key },
  });
  back(key, { notice: `${SYSTEM_EMAILS[key].name} is back to the default copy.` });
}

/**
 * Sends the copy in the form (saved or not) to the signed-in staff member only, with sample
 * values for the placeholders and a button that goes to the login page, never a real sign-in link.
 */
export async function sendSystemEmailTest(formData: FormData) {
  const { auth } = await emailStaff();
  const key = readKey(formData);
  const copy = readCopy(formData);
  const problem = systemEmailCopyProblem(key, copy);
  if (problem) back(key, { error: problem });
  const request = await currentRequest();
  const message = renderSystemEmail(key, {
    link: `${request.origin}/login`,
    origin: request.origin,
    values: SYSTEM_EMAILS[key].sample,
    overrides: { [key]: copy },
  });
  const result = await sendEmail({ to: auth.user.email, subject: `[Test] ${message.subject}`, html: message.html, text: message.text });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "system_email.test_sent",
    targetType: "platform_setting",
    targetId: SYSTEM_EMAIL_COPY_KEY,
    metadata: { email: key, delivery: result.status },
  });
  if (result.status === "sent") back(key, { notice: `Test sent to ${auth.user.email}. It uses the copy in the form, saved or not.` });
  if (result.status === "logged") back(key, { error: "Email is not set up on this server (RESEND_API_KEY is missing), so the test was not sent." });
  back(key, { error: `The test could not be sent. ${result.reason}` });
}
