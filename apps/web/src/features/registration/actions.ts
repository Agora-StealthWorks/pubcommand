"use server";

import { hashPassword, normalizeEmail, verifyPassword } from "@pubcommand/auth";
import { isAgentEmail, newPasswordProblem, parseEmailAddress } from "@pubcommand/core";
import { rawPrisma, registerOrganizationMember, resolveOrgBySlug } from "@pubcommand/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { establishSession } from "@/lib/auth";
import { registrationBlocked } from "@/lib/password-throttle";
import { currentRequest } from "@/lib/request";

function back(message: string): never {
  redirect(`/register?error=${encodeURIComponent(message)}`);
}

/**
 * The organization's public registration page (<org>.<root>/register). New people get an
 * account and join as a basic User; someone with a PubCommand account joins with their password.
 */
export async function registerAction(formData: FormData) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const org = await resolveOrgBySlug(request.site.slug);
  if (!org || org.redirected) back("This organization is not available.");
  const email = parseEmailAddress(normalizeEmail(String(formData.get("email") ?? "")).slice(0, 320));
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // The reserved AI-agent domain never registers (agents are added from AI Agents).
  if (!email || isAgentEmail(email)) back("Enter your email address.");
  const head = await headers();
  const ip = head.get("x-forwarded-for")?.split(",")[0]?.trim() || head.get("x-real-ip") || "";
  const blocked = registrationBlocked(email, ip);
  if (blocked) back(blocked);

  const existing = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, passwordHash: true } });
  let passwordHash: string | null = null;
  if (existing) {
    if (!existing.passwordHash) back("This email already has a PubCommand account without a password. Use “Forgot your password?” on the log-in page first, then come back.");
    if (!(await verifyPassword(password, existing.passwordHash))) back("This email already has a PubCommand account, and that password is not its password. Use your PubCommand password, or reset it on the log-in page.");
  } else {
    const problem = newPasswordProblem(password, confirm);
    if (problem) back(problem);
    passwordHash = await hashPassword(password);
  }

  const result = await registerOrganizationMember({ organizationId: org.id, email, name, passwordHash, existingUserId: existing?.id ?? null });
  if (!result.ok) {
    back(
      result.reason === "no-seats"
        ? `${org.name} has no open seats right now. Ask them to add one.`
        : result.reason === "disabled-account"
          ? "This account cannot join. Contact the organization."
          : `${org.name} is not taking sign-ups. Ask them for an invite.`,
    );
  }
  await establishSession(result.userId);
  redirect("/");
}
