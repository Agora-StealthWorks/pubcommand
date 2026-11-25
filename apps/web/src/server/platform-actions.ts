"use server";

import {
  PLATFORM_PERMISSIONS,
  isNiche,
  isPlatformRole,
  NICHE_LABELS,
  organizationInviteNotice,
  platformCan,
  validatePlanDraft,
  canManagePlatformStaff,
  hostnameConfirmationMatches,
  parseAppAccessChoice,
  passwordProblem,
  idleTimeoutLabel,
  parseIdleTimeoutChoice,
} from "@pubcommand/core";
import {
  addOrganizationMember as addOrganizationMemberRecord,
  addStaffAsOrganizationAdmin,
  appendOrgAudit,
  appendPlatformAudit,
  deleteUserAccount,
  platformTx,
  purgeOrganization,
  restoreOrganization,
  setOrganizationAppAccess,
  softDeleteOrganization,
  assignOrganizationPlan,
  changeOrganizationMemberRole as changeOrganizationMemberRoleRecord,
  changeOrganizationSlug,
  createCatalogPlan,
  provisionOrganization,
  rawPrisma,
  saveDefaultAppIds,
  removeOrganizationMember as removeOrganizationMemberRecord,
  resetUserTwoFactor,
  revokeUserSessions,
  setUserIdleTimeout,
  setOrganizationSuspended,
  setPlanArchived,
  setPlatformStaffAccess,
  setUserDisabled,
  setUserPasswordHash,
  updateCatalogPlan,
  updateUserProfile,
} from "@pubcommand/db";
import { IMPERSONATION_COOKIE, authCookieBase, hashPassword, normalizeEmail, sealImpersonation } from "@pubcommand/auth";
import { moduleRegistry } from "@pubcommand/modules";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearCustomHostCache } from "@/features/domains/resolve";
import { detachDomainsFromRailway } from "@/features/platform-admin/domains";
import { createLoginLink, readSession, readStaff, rootDomain, secret, staffReady } from "@/lib/auth";
import { deliverMagicLink, exposeMagicLinkOnPage, magicLinkUrl } from "@/lib/mail";
import { loadSystemEmailOverrides } from "@/features/system-emails/store";
import { currentRequest, siteUrl } from "@/lib/request";

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function staffMutation(permission: string) {
  const auth = await readSession();
  if (!auth.user || !auth.session?.mfaVerified) redirect("/2fa");
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session) || !platformCan(staff.role, permission)) {
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

function userHref(userId: string): string {
  return ORGANIZATION_ID.test(userId) ? `/users/${userId}` : "/users";
}

function allowedReturn(formData: FormData, organizationId: string): string {
  const fallback = organizationHref(organizationId);
  const next = String(formData.get("next") ?? "");
  if (next === fallback) return next;
  if (/^\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(next)) return next;
  return fallback;
}

function planDraft(formData: FormData, key?: string) {
  return validatePlanDraft(
    {
      name: String(formData.get("name") ?? ""),
      seatLimit: String(formData.get("seatLimit") ?? ""),
      brandLimit: String(formData.get("brandLimit") ?? ""),
      workspaceLimit: String(formData.get("workspaceLimit") ?? ""),
      monthlyPrice: String(formData.get("monthlyPrice") ?? ""),
      seatUnlimited: String(formData.get("seatUnlimited") ?? "") === "1",
      brandUnlimited: String(formData.get("brandUnlimited") ?? "") === "1",
      workspaceUnlimited: String(formData.get("workspaceUnlimited") ?? "") === "1",
      moduleIds: formData.getAll("moduleId").map((value) => String(value)),
    },
    key ? { key } : undefined,
  );
}

function catalogModuleIds() {
  return moduleRegistry.all().map((manifest) => manifest.id);
}

function organizationReturn(formData: FormData, organizationId: string): string {
  const next = String(formData.get("next") ?? "");
  return next === organizationHref(organizationId) ? next : "/orgs";
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function inviteNotice(userId: string, email: string, lead: string, organizationId?: string | null) {
  const link = await createLoginLink(userId);
  const request = await currentRequest();
  const magicUrl = magicLinkUrl(request.origin, link.token);
  const organizationName = organizationId
    ? ((await rawPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? null)
    : null;
  const delivered = await deliverMagicLink({ to: email, url: magicUrl, kind: "invite", organizationName, overrides: await loadSystemEmailOverrides() });
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
      catalogModuleIds: catalogModuleIds(),
      niche: String(formData.get("niche") ?? ""),
    });
  } catch (error) {
    redirect(`/orgs/new?error=${encodeURIComponent(failureMessage(error, "Could not create the organization."))}`);
  }
  if (!created) redirect("/orgs/new?error=Could not create the organization.");
  let notice = "Organization created.";
  try {
    notice = await inviteNotice(created.userId, created.adminEmail, "Organization created.", created.organizationId);
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
      notice = await inviteNotice(member.userId, member.email, "Member invited.", organizationId);
    } catch {
      notice = "Member invited. The sign-in email could not be sent.";
    }
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function removeOrganizationMember(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = allowedReturn(formData, organizationId);
  const { auth } = await staffMutation(
    href.startsWith("/users/") ? PLATFORM_PERMISSIONS.manageUsers : PLATFORM_PERMISSIONS.manageOrgs,
  );
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

/** Admin → Plans → Default apps: the apps new organizations start with switched on. */
export async function saveDefaultApps(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageModules);
  const niche = String(formData.get("niche") ?? "");
  if (!isNiche(niche)) redirect("/plans?error=Unknown niche.");
  await saveDefaultAppIds({
    actorId: auth.user.id,
    niche,
    moduleIds: formData.getAll("moduleId").map(String),
    allowedModuleIds: catalogModuleIds(),
  });
  redirect(`/plans?notice=${encodeURIComponent(`Default apps for ${NICHE_LABELS[niche]} saved. New organizations in that niche start with these switched on.`)}`);
}

export async function inviteStaff(formData: FormData) {
  const { auth, staff } = await staffMutation(PLATFORM_PERMISSIONS.manageStaff);
  if (!canManagePlatformStaff({ email: auth.user.email, role: staff.role })) {
    redirect("/staff?error=Only Stephen can manage staff.");
  }
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "");
  if (!isPlatformRole(role)) redirect("/staff?error=Choose a staff role.");
  if (!email.includes("@")) redirect("/staff?error=Enter an email address.");
  let userId = "";
  try {
    const existing = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    const user = existing ?? (await rawPrisma().user.create({ data: { email, passwordHash: null } }));
    userId = user.id;
    await setPlatformStaffAccess({ actorId: auth.user.id, userId: user.id, role });
  } catch (error) {
    redirect(`/staff?error=${encodeURIComponent(failureMessage(error, "Could not save that staff member."))}`);
  }
  const link = await createLoginLink(userId);
  const request = await currentRequest();
  const magicUrl = magicLinkUrl(request.origin, link.token);
  const delivered = await deliverMagicLink({ to: email, url: magicUrl, kind: "invite", overrides: await loadSystemEmailOverrides() });
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
  if (!canManagePlatformStaff({ email: auth.user.email, role: staff.role })) {
    redirect("/staff?error=Only Stephen can manage staff.");
  }
  const userId = String(formData.get("userId") ?? "");
  try {
    await setPlatformStaffAccess({ actorId: auth.user.id, userId, role: null });
  } catch (error) {
    redirect(`/staff?error=${encodeURIComponent(failureMessage(error, "Could not remove that staff member."))}`);
  }
  redirect("/staff?notice=Staff access removed.");
}

export async function createPlan(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.managePlans);
  const draft = planDraft(formData);
  if (!draft.ok) redirect(`/plans?error=${encodeURIComponent(draft.message)}`);
  try {
    await createCatalogPlan({
      actorId: auth.user.id,
      key: draft.key,
      name: draft.name,
      seatLimit: draft.seatLimit,
      brandLimit: draft.brandLimit,
      workspaceLimit: draft.workspaceLimit,
      monthlyPriceCents: draft.monthlyPriceCents,
      moduleIds: draft.moduleIds,
      allowedModuleIds: catalogModuleIds(),
    });
  } catch (error) {
    redirect(`/plans?error=${encodeURIComponent(failureMessage(error, "Could not create the plan."))}`);
  }
  redirect("/plans?notice=Plan created.");
}

export async function updatePlan(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.managePlans);
  const planId = String(formData.get("planId") ?? "");
  const existing = await rawPrisma().plan.findUnique({ where: { id: planId }, select: { key: true } });
  if (!existing) redirect("/plans?error=Unknown plan.");
  const draft = planDraft(formData, existing.key);
  if (!draft.ok) redirect(`/plans?error=${encodeURIComponent(draft.message)}`);
  try {
    await updateCatalogPlan({
      actorId: auth.user.id,
      planId,
      name: draft.name,
      seatLimit: draft.seatLimit,
      brandLimit: draft.brandLimit,
      workspaceLimit: draft.workspaceLimit,
      monthlyPriceCents: draft.monthlyPriceCents,
      moduleIds: draft.moduleIds,
      allowedModuleIds: catalogModuleIds(),
    });
  } catch (error) {
    redirect(`/plans?error=${encodeURIComponent(failureMessage(error, "Could not save the plan."))}`);
  }
  redirect("/plans?notice=Plan saved.");
}

export async function archivePlan(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.managePlans);
  const planId = String(formData.get("planId") ?? "");
  const archived = String(formData.get("archived") ?? "") === "1";
  try {
    await setPlanArchived({ actorId: auth.user.id, planId, archived });
  } catch (error) {
    redirect(`/plans?error=${encodeURIComponent(failureMessage(error, "Could not update the plan."))}`);
  }
  redirect(`/plans?notice=${encodeURIComponent(archived ? "Plan archived." : "Plan restored.")}`);
}

export async function changeOrganizationMemberRole(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = allowedReturn(formData, organizationId);
  const { auth } = await staffMutation(
    href.startsWith("/users/") ? PLATFORM_PERMISSIONS.manageUsers : PLATFORM_PERMISSIONS.manageOrgs,
  );
  try {
    await changeOrganizationMemberRoleRecord({
      organizationId,
      membershipId: String(formData.get("membershipId") ?? ""),
      roleId: String(formData.get("roleId") ?? ""),
      actorId: auth.user.id,
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not change that role."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Role updated.")}`);
}

export async function saveUserProfile(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  try {
    await updateUserProfile({
      actorId: auth.user.id,
      userId,
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not save that account."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Account saved.")}`);
}

export async function saveUserPassword(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  const clear = String(formData.get("clear") ?? "") === "1";
  let notice = "";
  try {
    if (clear) {
      await setUserPasswordHash({ actorId: auth.user.id, userId, passwordHash: null });
      notice = "Password cleared. Existing sessions were signed out.";
    } else {
      const password = String(formData.get("password") ?? "");
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      await setUserPasswordHash({ actorId: auth.user.id, userId, passwordHash: await hashPassword(password) });
      notice = "Password updated. Existing sessions were signed out.";
    }
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not update the password."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function resetUserAuthenticator(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  try {
    await resetUserTwoFactor({ actorId: auth.user.id, userId });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not reset two-factor authentication."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Two-factor authentication was reset. Existing sessions were signed out.")}`);
}

export async function signOutUserSessions(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  try {
    await revokeUserSessions({ actorId: auth.user.id, userId });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not sign that account out."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent("Signed out of all sessions.")}`);
}

export async function setUserIdleTimeoutAction(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  const choice = parseIdleTimeoutChoice(String(formData.get("minutes") ?? ""));
  if (!choice.ok) redirect(`${href}?error=${encodeURIComponent(choice.reason)}`);
  try {
    await setUserIdleTimeout({ actorId: auth.user.id, userId, minutes: choice.minutes });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not change the sign-out time."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(`Signs out after ${idleTimeoutLabel(choice.minutes)} without activity.`)}`);
}

export async function setUserAccess(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  const disabled = String(formData.get("disabled") ?? "") === "1";
  try {
    await setUserDisabled({ actorId: auth.user.id, userId, disabled });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not update that account."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(disabled ? "Account disabled." : "Account enabled.")}`);
}

export async function addUserOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageUsers);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  const [organizationId, roleId] = String(formData.get("placement") ?? "").split("|");
  let notice = "Membership saved.";
  try {
    const account = await rawPrisma().user.findUnique({ where: { id: userId } });
    if (!account || account.disabledAt) throw new Error(account ? "That account is disabled." : "Unknown account.");
    const member = await addOrganizationMemberRecord({
      organizationId: organizationId ?? "",
      email: account.email,
      roleId: roleId ?? "",
      actorId: auth.user.id,
    });
    if (member.status === "INVITED") {
      try {
        notice = await inviteNotice(member.userId, member.email, "Member invited.", organizationId);
      } catch {
        notice = "Member invited. The sign-in email could not be sent.";
      }
    }
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not add that membership."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function saveUserStaff(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageStaff);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  const remove = String(formData.get("remove") ?? "") === "1";
  const role = String(formData.get("role") ?? "");
  if (!remove && !isPlatformRole(role)) redirect(`${href}?error=${encodeURIComponent("Choose a staff role.")}`);
  try {
    await setPlatformStaffAccess({
      actorId: auth.user.id,
      userId,
      role: remove || !isPlatformRole(role) ? null : role,
    });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not update staff."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(remove ? "Staff access removed." : "Staff access saved.")}`);
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

export async function runJob(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageJobs);
  const name = String(formData.get("job") ?? "");
  const { runJobNow } = await import("@/lib/jobs/runner");
  const result = await runJobNow(name, auth.user.id);
  await appendPlatformAudit({ actorId: auth.user.id, action: "job.run", targetType: "job", targetId: name });
  redirect(result.ok ? `/usage/jobs?notice=${encodeURIComponent(`${name} started.`)}` : `/usage/jobs?error=${encodeURIComponent(result.reason ?? "Could not start.")}`);
}

// ── Per-organization app access ─────────────────────────────────────────────

export async function setOrgAppAccess(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.manageModules);
  const organizationId = String(formData.get("organizationId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const choice = parseAppAccessChoice(String(formData.get("access") ?? ""));
  if (!choice) redirect(`${organizationHref(organizationId)}?error=${encodeURIComponent("Choose an access level.")}`);
  try {
    await setOrganizationAppAccess({ organizationId, moduleId, choice, actorId: auth.user.id, knownModuleIds: catalogModuleIds() });
  } catch (error) {
    redirect(`${organizationHref(organizationId)}?error=${encodeURIComponent(failureMessage(error, "Could not change app access."))}`);
  }
  const name = moduleRegistry.getById(moduleId)?.name ?? moduleId;
  const label = choice === "PLAN" ? "follows the plan" : choice === "ALLOWED" ? "allowed" : "blocked";
  redirect(`${organizationHref(organizationId)}?notice=${encodeURIComponent(`${name} ${label}. Its data is kept either way.`)}#apps`);
}

// ── Deletes (super admin: platform.data.delete) ─────────────────────────────

export async function deleteOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.deleteData);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  try {
    await softDeleteOrganization({ organizationId, actorId: auth.user.id, confirm: String(formData.get("confirm") ?? "") });
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not delete the organization."))}`);
  }
  clearCustomHostCache();
  redirect(`${href}?notice=${encodeURIComponent("Organization deleted. Members lost access and its sites stopped serving. You can restore it for 30 days.")}`);
}

export async function restoreDeletedOrganization(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.deleteData);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  let stillSuspended = false;
  try {
    const restored = await restoreOrganization({ organizationId, actorId: auth.user.id });
    const row = await rawPrisma().organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } });
    stillSuspended = Boolean(row?.suspendedAt) && Boolean(restored);
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not restore the organization."))}`);
  }
  clearCustomHostCache();
  redirect(`${href}?notice=${encodeURIComponent(stillSuspended ? "Organization restored. It was suspended before it was deleted, so it is still suspended." : "Organization restored. Members, sites and domains work again.")}`);
}

export async function purgeOrganizationNow(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.deleteData);
  const organizationId = String(formData.get("organizationId") ?? "");
  const href = organizationHref(organizationId);
  let notice = "";
  try {
    const result = await purgeOrganization({
      organizationId,
      actorId: auth.user.id,
      confirm: String(formData.get("confirm") ?? ""),
      detachDomains: (rows) => detachDomainsFromRailway(rows),
    });
    const failed = result.domains.filter((row) => !row.ok).map((row) => row.hostname);
    notice = `${result.slug} was permanently deleted.`;
    if (failed.length) notice += ` Remove ${failed.join(", ")} from the Railway service by hand.`;
    if (result.purchasedDomains.length) notice += ` Registrations kept at the registrar: ${result.purchasedDomains.join(", ")}.`;
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not purge the organization."))}`);
  }
  redirect(`/orgs?show=deleted&notice=${encodeURIComponent(notice)}`);
}

export async function deleteUser(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.deleteData);
  const userId = String(formData.get("userId") ?? "");
  const href = userHref(userId);
  let notice = "";
  try {
    const result = await deleteUserAccount({ actorId: auth.user.id, userId, confirm: String(formData.get("confirm") ?? "") });
    notice = `${result.email} was deleted: signed out, removed from ${result.memberships} organization${result.memberships === 1 ? "" : "s"}, email and name scrubbed.`;
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(failureMessage(error, "Could not delete that account."))}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

export async function removeCustomDomain(formData: FormData) {
  const { auth } = await staffMutation(PLATFORM_PERMISSIONS.deleteData);
  const domainId = String(formData.get("domainId") ?? "");
  const back = String(formData.get("next") ?? "") === "org" ? null : "/domains";
  const row = ORGANIZATION_ID.test(domainId)
    ? await platformTx((tx) => tx.customDomain.findUnique({ where: { id: domainId } }))
    : null;
  if (!row) redirect(`/domains?error=${encodeURIComponent("That domain is not connected.")}`);
  const href = back ?? organizationHref(row.organizationId);
  if (!hostnameConfirmationMatches(String(formData.get("confirm") ?? ""), row.hostname)) {
    redirect(`${href}?error=${encodeURIComponent(`Type ${row.hostname} to confirm.`)}`);
  }
  const { removeDomain } = await import("@/features/domains/service");
  const { providersFromEnv } = await import("@/features/domains/access");
  const result = await removeDomain(providersFromEnv(), row.organizationId, row.id);
  if (!result.ok) redirect(`${href}?error=${encodeURIComponent(result.error)}`);
  const metadata = { hostnames: result.hostnames, provider: row.provider, organizationId: row.organizationId, registrationKept: row.provider === "CLOUDFLARE_PURCHASED" };
  await appendPlatformAudit({ actorId: auth.user.id, action: "domain.removed", targetType: "domain", targetId: row.id, metadata });
  await appendOrgAudit(row.organizationId, { actorId: auth.user.id, action: "domain.removed", targetType: "domain", targetId: row.id, metadata: { ...metadata, by: "PubCommand staff" } });
  const kept = row.provider === "CLOUDFLARE_PURCHASED" ? " The registration itself was not cancelled." : "";
  redirect(`${href}?notice=${encodeURIComponent(`${result.hostnames.join(", ")} removed and no longer served.${kept}`)}`);
}
