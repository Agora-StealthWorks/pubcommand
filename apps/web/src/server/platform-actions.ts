"use server";

import {
  PLATFORM_PERMISSIONS,
  isPlatformRole,
  organizationInviteNotice,
  platformCan,
} from "@pubcommand/core";
import {
  addOrganizationMember as addOrganizationMemberRecord,
  addStaffAsOrganizationAdmin,
  appendPlatformAudit,
  assignOrganizationPlan,
  changeOrganizationSlug,
  provisionOrganization,
  rawPrisma,
  removeOrganizationMember as removeOrganizationMemberRecord,
  setOrganizationSuspended,
} from "@pubcommand/db";
import { IMPERSONATION_COOKIE, authCookieBase, normalizeEmail, sealImpersonation } from "@pubcommand/auth";
import { moduleRegistry } from "@pubcommand/modules";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createLoginLink, readSession, readStaff, rootDomain, secret } from "@/lib/auth";
import { deliverMagicLink, exposeMagicLinkOnPage, magicLinkUrl } from "@/lib/mail";
import { currentRequest, siteUrl } from "@/lib/request";

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function staffMutation(permission: string) {
  const auth = await readSession();
  if (!auth.user || !auth.session?.mfaVerified) redirect("/2fa");
  const staff = await readStaff(auth.user.id);
  if (!staff || !staff.totpConfirmedAt || !platformCan(staff.role, permission)) {
    redirect("/?error=You do not have permission.");
  }
  return { auth, staff };
}

function permissionKeys() {
  return Object.keys(moduleRegistry.permissionModules());
}

function organizationHref(organizationId: string): string {
  return ORGANIZATION_ID.test(organizationId) ? `/orgs/${organizationId}` : "/orgs";
}

function organizationReturn(formData: FormData, organizationId: string): string {
  const next = String(formData.get("next") ?? "");
  return next === organizationHref(organizationId) ? next : "/orgs";
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function inviteNotice(userId: string, email: string, lead: string) {
  const link = await createLoginLink(userId);
  const request = await currentRequest();
  const magicUrl = magicLinkUrl(request.origin, link.token);
  const delivered = await deliverMagicLink({ to: email, url: magicUrl, kind: "invite" });
  return organizationInviteNotice({ lead, delivered, magicUrl, exposeOnPage: exposeMagicLinkOnPage() });
}

export async function suspendOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.suspendOrgs);
  const organizationId = String(formData.get("organizationId") ?? "");
  const suspend = String(formData.get("suspend") ?? "") === "1";
  const href = organizationReturn(formData, organizationId);
  try {
    await setOrganizationSuspended({ organizationId, suspend, actorId: auth.user.id });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not update the organization."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(suspend ? "Organization suspended." : "Organization reactivated.")}`);
}

export async function createOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageOrgs);
  let created: Awaited<ReturnType<typeof provisionOrganization>> | null = null;
  try {
    created = await provisionOrganization({
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      planId: String(formData.get("planId") ?? ""),
      adminEmail: String(formData.get("adminEmail") ?? ""),
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      permissionKeys: permissionKeys(),
    });
  } catch (error) {
    redirect(`/orgs/new?error=${encodeURIComponent(failureMessage(error, "Could not create the organization."))}`);
  }
  if (!created) redirect("/orgs/new?error=Could not create the organization.");
  let notice = "Organization created.";
  try {
    notice = await inviteNotice(created.userId, created.adminEmail, "Organization created.");
  } catch {
    notice = "Organization created. The sign-in email could not be sent.";
  }
  redirect(`/orgs?notice=${encodeURIComponent(notice)}`);
}

export async function addOrganizationMember(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageOrgs);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  let member: Awaited<ReturnType<typeof addOrganizationMemberRecord>> | null = null;
  try {
    member = await addOrganizationMemberRecord({
      organizationId,
      email: String(formData.get("email") ?? ""),
      roleId: String(formData.get("roleId") ?? ""),
      actorId: auth.user.id,
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not add that member."))}`);
  }
  if (!member) redirect(`${href}?error=Could not add that member.`);
  let notice = "Member updated.";
  if (member.status === "INVITED") {
    try {
      notice = await inviteNotice(member.userId, member.email, "Member invited.");
    } catch {
      notice = "Member invited. The sign-in email could not be sent.";
    }
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function removeOrganizationMember(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageOrgs);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  try {
    await removeOrganizationMemberRecord({
      organizationId,
      membershipId: String(formData.get("membershipId") ?? ""),
      actorId: auth.user.id,
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not remove that member."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Member removed.")}`);
}

export async function addSelfAsOrganizationAdmin(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageOrgs);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  let notice = "You are an admin of this organization.";
  try {
    const result = await addStaffAsOrganizationAdmin({
      organizationId,
      userId: auth.user.id,
      actorId: auth.user.id,
      permissionKeys: permissionKeys(),
    });
    if (!result.changed) notice = "You already administer this organization.";
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not add you to the organization."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function changeOrganizationPlan(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.managePlans);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  try {
    await assignOrganizationPlan({
      organizationId,
      planId: String(formData.get("planId") ?? ""),
      actorId: auth.user.id,
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not change the plan."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Plan updated.")}`);
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
  try {
    await assignOrganizationPlan({ organizationId, planId, actorId: auth.user.id });
  } catch (error) {
    redirect(`/plans?error=${encodeURIComponent(failureMessage(error, "Could not change the plan."))}`);
  }
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
