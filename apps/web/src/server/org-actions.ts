"use server";

import { buildSiteUrl, can, slugifyName } from "@pubcommand/core";
import { appendOrgAudit, appendPlatformAudit, changeOrganizationSlug, rawPrisma, tenantDb } from "@pubcommand/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createLoginLink, normalizeEmail } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

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
  await tenantDb(ctx.resolved.id).membership.upsert({
    where: { organizationId_userId: { organizationId: ctx.resolved.id, userId: user.id } },
    create: { organizationId: ctx.resolved.id, userId: user.id, roleId, status: "INVITED" },
    update: { roleId, status: "INVITED" },
  });
  const link = await createLoginLink(user.id);
  await audit(ctx, "user.invited", "user", user.id, { email });
  const dev = process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_EXPOSE_LINKS === "true";
  const request = await currentRequest();
  const proto = request.host.includes("localhost") || request.host.startsWith("127.") ? "http" : "https";
  const magicUrl = `${proto}://${request.host}/api/auth/magic-link/verify?token=${link.token}`;
  redirect(
    `/settings/users?notice=${encodeURIComponent(dev ? `Invite created. Magic link: ${magicUrl}` : "Invite created. They can request a magic link.")}`,
  );
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
  await tenantDb(ctx.resolved.id).role.create({
    data: {
      organizationId: ctx.resolved.id,
      name,
      slug: brandId ? `${slug}-${brandId.slice(0, 8)}` : slug,
      brandId,
      isSystem: false,
    },
  });
  await audit(ctx, "role.created", "role", undefined, { name });
  redirect("/settings/roles?notice=Role created.");
}

export async function toggleGrant(formData: FormData) {
  const ctx = await orgMutation("settings.roles.manage");
  const roleId = String(formData.get("roleId") ?? "");
  const permission = String(formData.get("permission") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const role = await tenantDb(ctx.resolved.id).role.findFirst({ where: { id: roleId } });
  if (!role || !ctx.subject.permissionModules[permission]) redirect("/settings/roles?error=Unknown role or permission.");
  if (enabled) {
    await tenantDb(ctx.resolved.id).rolePermission.create({
      data: { organizationId: ctx.resolved.id, roleId, permission, effect: "ALLOW" },
    }).catch(async () => {
      await tenantDb(ctx.resolved.id).rolePermission.updateMany({
        where: { roleId, permission },
        data: { effect: "ALLOW" },
      });
    });
  } else {
    await tenantDb(ctx.resolved.id).rolePermission.deleteMany({ where: { roleId, permission } });
  }
  await audit(ctx, enabled ? "permission.granted" : "permission.revoked", "role", roleId, { permission });
  redirect("/settings/roles?notice=Permissions updated.");
}

export async function toggleModule(formData: FormData) {
  const ctx = await orgMutation("settings.modules.manage");
  const moduleId = String(formData.get("moduleId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  await tenantDb(ctx.resolved.id).organizationModule.upsert({
    where: { organizationId_moduleId: { organizationId: ctx.resolved.id, moduleId } },
    create: { organizationId: ctx.resolved.id, moduleId, enabled },
    update: { enabled },
  });
  await audit(ctx, "module.entitlement.changed", "module", moduleId, { enabled: String(enabled) });
  redirect("/settings/modules?notice=Module updated.");
}
