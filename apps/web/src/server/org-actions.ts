"use server";

import {
  adjustableModule,
  buildSiteUrl,
  can,
  classifyPermissions,
  isAlwaysOnModule,
  isNiche,
  memberAccessChangeBlocked,
  moduleAllowed,
  LOCKED_ROLE_SLUGS,
  newPasswordProblem,
  parseMemberAppChoice,
  roleGrantChangeBlocked,
  roleGrantChanges,
  slugifyName,
} from "@pubcommand/core";
import { hashPassword } from "@pubcommand/auth";
import { moduleRegistry } from "@pubcommand/modules";
import {
  appendOrgAudit,
  appendPlatformAudit,
  changeOrganizationSlug,
  loadEntitlementState,
  rawPrisma,
  setMemberPassword,
  tenantDb,
} from "@pubcommand/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createLoginLink, normalizeEmail } from "@/lib/auth";
import { deliverMagicLink, exposeMagicLinkOnPage, magicLinkUrl } from "@/lib/mail";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { roleAccessSections } from "@/lib/role-access";

async function orgMutation(permission: string) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/?error=Choose an organization.");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind === "anonymous") redirect(`/login?next=${encodeURIComponent(request.pathname)}`);
  if (ctx.kind !== "ok") redirect("/?error=You do not have access to that organization.");
  if (!can(ctx.subject, permission, { organizationId: ctx.resolved.id, brandId: ctx.scope.brandId ?? null })) {
    redirect(`${request.pathname}?error=${encodeURIComponent("You do not have permission.")}`);
  }
  return ctx;
}

async function audit(ctx: Awaited<ReturnType<typeof orgMutation>>, action: string, targetType: string, targetId?: string, metadata?: Record<string, string>) {
  const actorId = ctx.auth.user.id;
  await appendOrgAudit(ctx.resolved.id, {
    actorId,
    action,
    targetType,
    targetId,
    metadata: { ...metadata, ...(ctx.impersonatingHere ? { impersonatedUserId: ctx.impersonatingHere.targetUserId } : {}) },
  });
  if (ctx.impersonatingHere) {
    await appendPlatformAudit({
      actorId,
      action,
      targetType,
      targetId,
      metadata: { organizationId: ctx.resolved.id, impersonatedUserId: ctx.impersonatingHere.targetUserId, ...(metadata ?? {}) },
    });
  }
}

export async function setBrand(formData: FormData) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const org = await getOrgContext(request.site.slug);
  if (org.kind !== "ok") redirect("/");
  const brandId = String(formData.get("brandId") ?? "");
  if (!org.brands.some((brand) => brand.id === brandId)) redirect(`${request.pathname}?error=Unknown brand`);
  (await cookies()).set("pc_brand", brandId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(request.pathname || "/");
}

export async function updateSettings(formData: FormData) {
  const ctx = await orgMutation("settings.manage");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const supportEmail = String(formData.get("supportEmail") ?? "").trim();
  if (!displayName) redirect("/settings?error=Display name is required.");
  await tenantDb(ctx.resolved.id).orgSettings.updateMany({
    where: {},
    data: { displayName, timezone: timezone || "America/New_York", supportEmail: supportEmail || null },
  });
  await audit(ctx, "settings.updated", "organization", ctx.resolved.id);
  redirect("/settings?notice=Settings saved.");
}

export async function updateSlug(formData: FormData) {
  const ctx = await orgMutation("settings.manage");
  let updatedSlug = ctx.resolved.slug;
  try {
    const updated = await changeOrganizationSlug(ctx.resolved.id, String(formData.get("slug") ?? ""));
    updatedSlug = updated.slug;
    await audit(ctx, "settings.slug.changed", "organization", ctx.resolved.id, { slug: updated.slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change the slug.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  const request = await currentRequest();
  redirect(
    buildSiteUrl({
      rootDomain: process.env.ROOT_DOMAIN ?? "localhost",
      requestHost: request.host,
      site: { kind: "org", slug: updatedSlug },
      pathname: "/settings",
      search: "?notice=Slug updated. The previous address redirects here.",
    }),
  );
}

export async function inviteUser(formData: FormData) {
  const ctx = await orgMutation("settings.users.manage");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const roleId = String(formData.get("roleId") ?? "");
  if (!email.includes("@")) redirect("/settings/users?error=Enter an email address.");
  const role = await tenantDb(ctx.resolved.id).role.findFirst({ where: { id: roleId } });
  if (!role) redirect("/settings/users?error=Choose a role.");
  const existing = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const user = existing ?? (await rawPrisma().user.create({ data: { email, passwordHash: null } }));
  const existingMember = await tenantDb(ctx.resolved.id).membership.findFirst({ where: { userId: user.id } });
  if (existingMember?.status === "ACTIVE") redirect("/settings/users?error=That person is already a member. Change their role from their profile.");
  if (existingMember) {
    await tenantDb(ctx.resolved.id).membership.updateMany({ where: { id: existingMember.id }, data: { roleId, status: "INVITED" } });
  } else {
    await tenantDb(ctx.resolved.id).membership.create({ data: { organizationId: ctx.resolved.id, userId: user.id, roleId, status: "INVITED" } });
  }
  const link = await createLoginLink(user.id);
  await audit(ctx, "user.invited", "user", user.id, { email });
  const request = await currentRequest();
  const magicUrl = magicLinkUrl(request.origin, link.token);
  const delivered = await deliverMagicLink({ to: email, url: magicUrl, kind: "invite", organizationName: ctx.resolved.name });
  const notice = exposeMagicLinkOnPage()
    ? `Invite created. Magic link: ${magicUrl}`
    : delivered === "sent"
      ? "Invite created. A sign-in link was emailed."
      : delivered === "failed"
        ? "Invite created, but the sign-in email could not be sent."
        : "Invite created.";
  redirect(`/settings/users?notice=${encodeURIComponent(notice)}`);
}

export async function addExclusion(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const userId = String(formData.get("userId") ?? "");
  const permission = String(formData.get("permission") ?? "");
  if (!ctx.subject.permissionModules[permission]) redirect("/settings/users?error=Unknown permission.");
  await tenantDb(ctx.resolved.id).exclusion.create({
    data: { organizationId: ctx.resolved.id, userId, permission, reason: "Added from the users screen." },
  });
  await audit(ctx, "permission.excluded", "user", userId, { permission });
  redirect("/settings/users?notice=Exclusion added.");
}

export async function createRole(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugifyName(name);
  if (!name || slug.length < 2) redirect("/settings/roles?error=Enter a role name.");
  const brandId = String(formData.get("brandId") ?? "") || null;
  if (brandId && !ctx.brands.some((brand) => brand.id === brandId)) redirect("/settings/roles?error=Unknown brand.");
  const roleSlug = brandId ? `${slug}-${brandId.slice(0, 8)}` : slug;
  if (await tenantDb(ctx.resolved.id).role.findFirst({ where: { slug: roleSlug } })) {
    redirect(`/settings/roles?error=${encodeURIComponent("A role with that name already exists.")}`);
  }
  await tenantDb(ctx.resolved.id).role.create({
    data: {
      organizationId: ctx.resolved.id,
      name,
      slug: roleSlug,
      brandId,
      isSystem: false,
    },
  });
  await audit(ctx, "role.created", "role", undefined, { name });
  redirect(`/settings/roles?notice=${encodeURIComponent(`${name} added. It has no access yet: set it in the tables below.`)}`);
}

export async function toggleModule(formData: FormData) {
  const ctx = await orgMutation("settings.modules.manage");
  const moduleId = String(formData.get("moduleId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (isAlwaysOnModule(moduleId)) redirect("/settings/modules?error=Settings is always on.");
  // Only apps PubCommand allows (plan or staff override) can be switched; data is never deleted.
  const state = await loadEntitlementState(ctx.resolved.id);
  if (!state || !moduleAllowed(moduleId, state)) redirect("/settings/modules?error=That app is not included. Ask PubCommand to add it.");
  const db = tenantDb(ctx.resolved.id);
  const updated = await db.organizationModule.updateMany({ where: { moduleId }, data: { enabled } });
  if (updated.count === 0) await db.organizationModule.create({ data: { organizationId: ctx.resolved.id, moduleId, enabled } });
  await audit(ctx, "module.entitlement.changed", "module", moduleId, { enabled: String(enabled) });
  redirect(`/settings/modules?notice=${encodeURIComponent(enabled ? "App turned on." : "App turned off. Its data is kept; turning it back on restores it.")}`);
}

function brandFields(formData: FormData) {
  const niche = String(formData.get("niche") ?? "general");
  return {
    niche: isNiche(niche) ? niche : "general",
    audience: String(formData.get("audience") ?? "").trim().slice(0, 1000) || null,
    complianceNotes: String(formData.get("complianceNotes") ?? "").trim().slice(0, 2000) || null,
  };
}

export async function createBrand(formData: FormData) {
  const ctx = await orgMutation("settings.manage");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 80) redirect("/settings/brands?error=Enter a brand name (up to 80 characters).");
  const base = slugifyName(name) || "brand";
  const db = tenantDb(ctx.resolved.id);
  const taken = new Set((await db.brand.findMany({ select: { slug: true } })).map((row) => row.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base.slice(0, 36)}-${n}`;
  const brand = await db.brand.create({ data: { organizationId: ctx.resolved.id, name, slug, ...brandFields(formData) } });
  await db.workspace.create({ data: { organizationId: ctx.resolved.id, brandId: brand.id, name: "General", slug: "general" } });
  await audit(ctx, "brand.created", "brand", brand.id, { name });
  redirect(`/settings/brands?notice=${encodeURIComponent(`${name} added.`)}`);
}

export async function updateBrand(formData: FormData) {
  const ctx = await orgMutation("settings.manage");
  const brandId = String(formData.get("brandId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 80) redirect("/settings/brands?error=Enter a brand name (up to 80 characters).");
  const fields = brandFields(formData);
  const result = await tenantDb(ctx.resolved.id).brand.updateMany({ where: { id: brandId }, data: { name, ...fields } });
  if (result.count === 0) redirect("/settings/brands?error=Unknown brand.");
  await audit(ctx, "brand.updated", "brand", brandId, { name, niche: fields.niche });
  redirect(`/settings/brands?notice=${encodeURIComponent(`${name} saved.`)}`);
}

// ── Member profile: role and per-app access (Settings → Users → member) ─────────

function memberHref(userId: string): string {
  return /^[0-9a-f-]{36}$/i.test(userId) ? `/settings/users/${userId}` : "/settings/users";
}

export async function setMemberAppAccess(formData: FormData) {
  const ctx = await orgMutation("settings.users.manage");
  const userId = String(formData.get("userId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const choice = parseMemberAppChoice(String(formData.get("level") ?? ""));
  const href = memberHref(userId);
  if (!choice) redirect(`${href}?error=Choose an access level.`);
  const db = tenantDb(ctx.resolved.id);
  const member = await db.membership.findFirst({ where: { userId, status: { in: ["ACTIVE", "INVITED"] } } });
  if (!member) redirect("/settings/users?error=Unknown member.");
  const classified = classifyPermissions(moduleRegistry.all());
  const blocked = memberAccessChangeBlocked({
    actorUserId: ctx.effectiveUserId,
    targetUserId: userId,
    moduleEntitled: ctx.subject.entitledModuleIds.includes(moduleId),
    moduleAdjustable: adjustableModule(moduleId, classified),
  });
  if (blocked) redirect(`${href}?error=${encodeURIComponent(blocked)}`);
  const before = await db.memberAppAccess.findFirst({ where: { userId, moduleId } });
  if (choice === "ROLE") {
    await db.memberAppAccess.deleteMany({ where: { userId, moduleId } });
  } else if (before) {
    await db.memberAppAccess.updateMany({ where: { userId, moduleId }, data: { level: choice, updatedById: ctx.auth.user.id } });
  } else {
    await db.memberAppAccess.create({ data: { organizationId: ctx.resolved.id, userId, moduleId, level: choice, updatedById: ctx.auth.user.id } });
  }
  await audit(ctx, "member.app_access.changed", "user", userId, { moduleId, from: before?.level ?? "ROLE", to: choice });
  redirect(`${href}?notice=${encodeURIComponent("App access saved.")}`);
}

export async function changeMemberRole(formData: FormData) {
  const ctx = await orgMutation("settings.users.manage");
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const href = memberHref(userId);
  if (userId === ctx.effectiveUserId) redirect(`${href}?error=${encodeURIComponent("You cannot change your own role.")}`);
  const db = tenantDb(ctx.resolved.id);
  const [member, role] = await Promise.all([
    db.membership.findFirst({ where: { userId, status: { in: ["ACTIVE", "INVITED"] } }, include: { role: true } }),
    db.role.findFirst({ where: { id: roleId } }),
  ]);
  if (!member || !role) redirect(`${href}?error=Unknown member or role.`);
  if (member.roleId === role.id) redirect(href);
  const adminSlugs = ["owner", "admin"];
  if (adminSlugs.includes(member.role.slug) && !adminSlugs.includes(role.slug)) {
    const others = await db.membership.count({ where: { userId: { not: userId }, status: "ACTIVE", role: { slug: { in: adminSlugs } } } });
    if (others === 0) redirect(`${href}?error=${encodeURIComponent("This is the last admin. Make someone else an admin first.")}`);
  }
  if (role.slug === "owner" && !can(ctx.subject, "settings.roles.manage", ctx.scope)) {
    redirect(`${href}?error=${encodeURIComponent("Only someone who manages roles can make an owner.")}`);
  }
  await db.membership.updateMany({ where: { id: member.id }, data: { roleId: role.id } });
  await audit(ctx, "member.role.changed", "user", userId, { from: member.role.slug, to: role.slug });
  redirect(`${href}?notice=${encodeURIComponent(`Role changed to ${role.name}.`)}`);
}

export async function setMemberPasswordAction(formData: FormData) {
  const ctx = await orgMutation("settings.users.manage");
  const userId = String(formData.get("userId") ?? "");
  const href = memberHref(userId);
  const password = String(formData.get("newPassword") ?? "");
  const problem = newPasswordProblem(password, String(formData.get("confirmPassword") ?? ""));
  if (problem) redirect(`${href}?error=${encodeURIComponent(problem)}`);
  let notice = "";
  try {
    const result = await setMemberPassword({
      organizationId: ctx.resolved.id,
      actorId: ctx.auth.user.id,
      actorCanManageUsers: can(ctx.subject, "settings.users.manage", ctx.scope),
      impersonating: Boolean(ctx.impersonatingHere),
      targetUserId: userId,
      passwordHash: await hashPassword(password),
    });
    notice = `Password set. They were signed out everywhere${result.sessionsSignedOut ? ` (${result.sessionsSignedOut} session${result.sessionsSignedOut === 1 ? "" : "s"})` : ""}. Tell them the new password privately.`;
  } catch (error) {
    redirect(`${href}?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not set the password.")}`);
  }
  redirect(`${href}?notice=${encodeURIComponent(notice)}`);
}

// ── Roles & access: one table per app ────────────────────────────────────────

function rolesHref(kind: "error" | "notice", message: string, section?: string): string {
  const anchor = section && /^[a-z0-9-]+$/.test(section) ? `&saved=${section}#access-${section}` : "";
  return `/settings/roles?${kind}=${encodeURIComponent(message)}${anchor}`;
}

/**
 * Saves one app's table: for every editable role in the form, the checked
 * permissions of that app become exactly its grants. Other apps are untouched.
 */
export async function saveRoleAccess(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const sectionId = String(formData.get("section") ?? "");
  const section = roleAccessSections(ctx.subject.entitledModuleIds).included.find((item) => item.id === sectionId);
  if (!section) redirect(rolesHref("error", "That app is not part of this organization."));
  const sectionKeys = section.permissions.map((permission) => permission.key);
  const db = tenantDb(ctx.resolved.id);
  const roleIds = [...new Set(formData.getAll("roleId").map(String))];
  const roles = await db.role.findMany({ where: { id: { in: roleIds } }, include: { grants: true } });
  const checked = new Set(formData.getAll("grant").map(String));
  const plans = [];
  for (const role of roles) {
    if (LOCKED_ROLE_SLUGS.includes(role.slug)) continue;
    const current = role.grants.filter((grant) => grant.effect === "ALLOW").map((grant) => grant.permission);
    const desired = sectionKeys.filter((key) => checked.has(`${role.id}|${key}`));
    const change = roleGrantChanges({ current, desired, sectionKeys });
    if (change.add.length === 0 && change.remove.length === 0) continue;
    const blocked = roleGrantChangeBlocked({ roleSlug: role.slug, isActorsRole: role.id === ctx.subject.roleId, remove: change.remove });
    if (blocked) redirect(rolesHref("error", blocked, section.id));
    plans.push({ role, ...change });
  }
  for (const plan of plans) {
    if (plan.remove.length > 0) await db.rolePermission.deleteMany({ where: { roleId: plan.role.id, permission: { in: plan.remove } } });
    for (const permission of plan.add) {
      await db.rolePermission
        .create({ data: { organizationId: ctx.resolved.id, roleId: plan.role.id, permission, effect: "ALLOW" } })
        .catch(async () => {
          await db.rolePermission.updateMany({ where: { roleId: plan.role.id, permission }, data: { effect: "ALLOW" } });
        });
    }
    await audit(ctx, "role.permissions.updated", "role", plan.role.id, {
      role: plan.role.name,
      app: section.name,
      added: plan.add.join(","),
      removed: plan.remove.join(","),
    });
  }
  const message = plans.length === 0 ? `${section.name}: nothing changed.` : `${section.name} access saved for ${plans.map((plan) => plan.role.name).join(", ")}.`;
  redirect(rolesHref("notice", message, section.id));
}

export async function renameRole(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const roleId = String(formData.get("roleId") ?? "");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) redirect(rolesHref("error", "Enter a role name (up to 60 characters)."));
  const db = tenantDb(ctx.resolved.id);
  const role = await db.role.findFirst({ where: { id: roleId } });
  if (!role) redirect(rolesHref("error", "Unknown role."));
  if (role.isSystem) redirect(rolesHref("error", "Built-in roles keep their names."));
  await db.role.updateMany({ where: { id: role.id }, data: { name } });
  await audit(ctx, "role.renamed", "role", role.id, { from: role.name, to: name });
  redirect(rolesHref("notice", `Role renamed to ${name}.`));
}

export async function deleteRole(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const roleId = String(formData.get("roleId") ?? "");
  const db = tenantDb(ctx.resolved.id);
  const role = await db.role.findFirst({ where: { id: roleId } });
  if (!role) redirect(rolesHref("error", "Unknown role."));
  if (role.isSystem) redirect(rolesHref("error", "Built-in roles cannot be deleted."));
  const people = await db.membership.count({ where: { roleId: role.id } });
  if (people > 0) {
    redirect(rolesHref("error", `${people} ${people === 1 ? "person has" : "people have"} the ${role.name} role. Give them another role first (Settings → Users).`));
  }
  await db.exclusion.deleteMany({ where: { roleId: role.id } });
  await db.rolePermission.deleteMany({ where: { roleId: role.id } });
  await db.role.deleteMany({ where: { id: role.id } });
  await audit(ctx, "role.deleted", "role", role.id, { name: role.name });
  redirect(rolesHref("notice", `${role.name} role deleted.`));
}
