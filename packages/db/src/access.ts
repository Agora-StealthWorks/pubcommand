import type { AccessSubject } from "@pubcommand/core";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./tenant";

export async function loadAccessSubject(
  organizationId: string,
  userId: string,
  permissionModules: Readonly<Record<string, string>>,
): Promise<AccessSubject | null> {
  const db = tenantDb(organizationId);
  const membership = await db.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { role: { include: { grants: true } } },
  });
  if (!membership) return null;
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: { plan: { include: { modules: true } }, modules: true },
  });
  if (!organization) return null;
  const exclusions = await db.exclusion.findMany();
  const entitled = new Set<string>(["settings"]);
  for (const planModule of organization.plan.modules) {
    const toggle = organization.modules.find((row) => row.moduleId === planModule.moduleId);
    if (!toggle || toggle.enabled) entitled.add(planModule.moduleId);
  }
  return {
    userId,
    organizationId,
    roleId: membership.roleId,
    membershipBrandId: membership.brandId,
    membershipWorkspaceId: membership.workspaceId,
    grants: membership.role.grants.map((grant) => ({
      permission: grant.permission,
      effect: grant.effect === "DENY" ? "deny" : "allow",
      brandId: membership.role.brandId,
      workspaceId: membership.role.workspaceId,
      roleId: membership.roleId,
    })),
    exclusions: exclusions.map((exclusion) => ({
      permission: exclusion.permission,
      userId: exclusion.userId,
      roleId: exclusion.roleId,
      brandId: exclusion.brandId,
      workspaceId: exclusion.workspaceId,
    })),
    entitledModuleIds: [...entitled],
    permissionModules,
  };
}

/**
 * Full access for the platform SUPER_ADMIN in any organization, even without a
 * membership. The caller must confirm the user is an active SUPER_ADMIN with a
 * 2FA-verified session. Org module toggles still apply; the plan does not.
 */
export async function loadSuperAdminSubject(
  organizationId: string,
  userId: string,
  permissionModules: Readonly<Record<string, string>>,
): Promise<AccessSubject | null> {
  const organization = await tenantDb(organizationId).organization.findUnique({
    where: { id: organizationId },
    include: { modules: true },
  });
  if (!organization) return null;
  const disabled = new Set(organization.modules.filter((row) => !row.enabled).map((row) => row.moduleId));
  const entitled = new Set<string>(["settings"]);
  for (const moduleId of Object.values(permissionModules)) {
    if (!disabled.has(moduleId)) entitled.add(moduleId);
  }
  const roleId = "platform-super-admin";
  return {
    userId,
    organizationId,
    roleId,
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants: Object.keys(permissionModules).map((permission) => ({
      permission,
      effect: "allow" as const,
      brandId: null,
      workspaceId: null,
      roleId,
    })),
    exclusions: [],
    entitledModuleIds: [...entitled],
    permissionModules,
  };
}

export async function appendOrgAudit(
  organizationId: string,
  entry: {
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tenantDb(organizationId).auditLog.create({
    data: {
      organizationId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
    },
  });
}
