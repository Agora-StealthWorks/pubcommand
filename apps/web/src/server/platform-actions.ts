"use server";

import {
  PLATFORM_PERMISSIONS,
  isPlatformRole,
  platformCan,
} from "@pubcommand/core";
import { appendPlatformAudit, changeOrganizationSlug, rawPrisma } from "@pubcommand/db";
import { IMPERSONATION_COOKIE, authCookieBase, normalizeEmail, sealImpersonation } from "@pubcommand/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createLoginLink, readSession, readStaff, rootDomain, secret } from "@/lib/auth";
import { deliverMagicLink, exposeMagicLinkOnPage, magicLinkUrl } from "@/lib/mail";
import { currentRequest, siteUrl } from "@/lib/request";

async function staffMutation(permission: string) {
  const auth = await readSession();
  if (!auth.user || !auth.session?.mfaVerified) redirect("/2fa");
  const staff = await readStaff(auth.user.id);
  if (!staff || !staff.totpConfirmedAt || !platformCan(staff.role, permission)) {
    redirect("/?error=You do not have permission.");
  }
  return { auth, staff };
}

export async function suspendOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.suspendOrgs);
  const organizationId = String(formData.get("organizationId") ?? "");
  const suspend = String(formData.get("suspend") ?? "") === "1";
  await rawPrisma().organization.update({
    where: { id: organizationId },
    data: { suspendedAt: suspend ? new Date() : null },
  });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: suspend ? "org.suspended" : "org.unsuspended",
    targetType: "organization",
    targetId: organizationId,
  });
  redirect("/orgs?notice=Organization updated.");
}

export async function overrideSlug(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageDomains);
  const organizationId = String(formData.get("organizationId") ?? "");
  try {
    const updated = await changeOrganizationSlug(organizationId, String(formData.get("slug") ?? ""));
    await appendPlatformAudit({
      actorId: auth.user.id,
      action: "org.slug.overridden",
      targetType: "organization",
      targetId: organizationId,
      metadata: { slug: updated.slug },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change the slug.";
    redirect(`/domains?error=${encodeURIComponent(message)}`);
  }
  redirect("/domains?notice=Slug updated.");
}

export async function assignPlan(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.managePlans);
  const organizationId = String(formData.get("organizationId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const plan = await rawPrisma().plan.findUnique({ where: { id: planId } });
  if (!plan) redirect("/plans?error=Unknown plan.");
  await rawPrisma().organization.update({
    where: { id: organizationId },
    data: { planId: plan.id, seatLimit: plan.seatLimit },
  });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "org.plan.changed",
    targetType: "organization",
    targetId: organizationId,
    metadata: { plan: plan.key },
  });
  redirect("/plans?notice=Plan updated.");
}

export async function togglePlanModule(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageModules);
  const planId = String(formData.get("planId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (enabled) {
    await rawPrisma().planModule.upsert({
      where: { planId_moduleId: { planId, moduleId } },
      create: { planId, moduleId },
      update: {},
    });
  } else if (moduleId !== "settings") {
    await rawPrisma().planModule.deleteMany({ where: { planId, moduleId } });
  }
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "plan.module.changed",
    targetType: "plan",
    targetId: planId,
    metadata: { moduleId, enabled: String(enabled || moduleId === "settings") },
  });
  redirect("/plans?notice=Plan modules updated.");
}

export async function inviteStaff(formData: FormData) {
  const { auth, staff } = await staffMutation(PLATFORM_PERMISSIONS.manageStaff);
  if (staff.role !== "SUPER_ADMIN") redirect("/staff?error=Only a super admin can invite staff.");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "");
  if (!isPlatformRole(role)) redirect("/staff?error=Choose a staff role.");
  const existing = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const user = existing ?? (await rawPrisma().user.create({ data: { email, passwordHash: null } }));
  const prior = await rawPrisma().platformStaff.findUnique({ where: { userId: user.id } });
  if (prior) {
    await rawPrisma().platformStaff.update({ where: { id: prior.id }, data: { role, disabledAt: null } });
  } else {
    await rawPrisma().platformStaff.create({ data: { userId: user.id, role } });
  }
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "staff.invited",
    targetType: "user",
    targetId: user.id,
    metadata: { email, role },
  });
  const link = await createLoginLink(user.id);
  const request = await currentRequest();
  const magicUrl = magicLinkUrl(request.origin, link.token);
  const delivered = await deliverMagicLink({ to: email, url: magicUrl, kind: "invite" });
  const notice = exposeMagicLinkOnPage()
    ? `Staff member saved. Magic link: ${magicUrl}`
    : delivered === "sent"
      ? "Staff member saved. A sign-in link was emailed. They must enroll 2FA before the console opens."
      : delivered === "failed"
        ? "Staff member saved, but the sign-in email could not be sent. They must enroll 2FA before the console opens."
        : "Staff member saved. They must enroll 2FA before the console opens.";
  redirect(`/staff?notice=${encodeURIComponent(notice)}`);
}

export async function disableStaff(formData: FormData) {
  const { auth, staff } = await staffMutation(PLATFORM_PERMISSIONS.manageStaff);
  if (staff.role !== "SUPER_ADMIN") redirect("/staff?error=Only a super admin can remove staff.");
  const userId = String(formData.get("userId") ?? "");
  if (userId === auth.user.id) redirect("/staff?error=You cannot remove your own staff access.");
  const target = await rawPrisma().platformStaff.findUnique({ where: { userId } });
  if (!target) redirect("/staff?error=That person is not staff.");
  if (target.role === "SUPER_ADMIN") {
    const remaining = await rawPrisma().platformStaff.count({
      where: { role: "SUPER_ADMIN", disabledAt: null, userId: { not: userId } },
    });
    if (remaining < 1) redirect("/staff?error=Keep at least one super admin.");
  }
  await rawPrisma().platformStaff.update({ where: { userId }, data: { disabledAt: new Date() } });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "staff.removed",
    targetType: "user",
    targetId: userId,
  });
  redirect("/staff?notice=Staff access removed.");
}

export async function startImpersonation(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.impersonate);
  const organizationId = String(formData.get("organizationId") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const user = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const membership = user
    ? await rawPrisma().membership.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
      })
    : null;
  if (!user || !membership || membership.status !== "ACTIVE") {
    redirect("/orgs?error=That person is not an active member of the organization.");
  }
  const organization = await rawPrisma().organization.findUnique({ where: { id: organizationId } });
  if (!organization) redirect("/orgs?error=Unknown organization.");
  const token = await sealImpersonation(
    { staffUserId: auth.user.id, targetUserId: user.id, organizationId },
    secret(),
  );
  (await cookies()).set(IMPERSONATION_COOKIE, token, { ...authCookieBase(rootDomain()), maxAge: 60 * 60 * 2 });
  await appendPlatformAudit({
    actorId: auth.user.id,
    action: "staff.impersonation.started",
    targetType: "user",
    targetId: user.id,
    metadata: { organizationId },
  });
  redirect(await siteUrl({ kind: "org", slug: organization.slug }));
}

export async function stopImpersonation() {
  const auth = await readSession();
  (await cookies()).set(IMPERSONATION_COOKIE, "", { ...authCookieBase(rootDomain()), maxAge: 0 });
  if (auth.user) {
    await appendPlatformAudit({
      actorId: auth.user.id,
      action: "staff.impersonation.stopped",
      targetType: "user",
      targetId: auth.user.id,
    });
  }
  redirect(await siteUrl({ kind: "admin" }, "/orgs"));
}
