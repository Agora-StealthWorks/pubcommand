import { classifyPermissions, memberAppAccessRules, type AccessSubject } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import type { Prisma } from "@prisma/client";
import { entitledFromState, loadEntitlementState, superAdminEntitledFromState } from "./entitlements";
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
  const state = await loadEntitlementState(organizationId);
  if (!state || state.deleted) return null;
  const [exclusions, appLevels] = await Promise.all([
    db.exclusion.findMany(),
    db.memberAppAccess.findMany({ where: { userId } }),
  ]);
  const member = memberAppAccessRules({
    userId,
    levels: Object.fromEntries(appLevels.map((row) => [row.moduleId, row.level])),
    classified: classifyPermissions(moduleRegistry.all()),
  });
  return {
    userId,
    organizationId,
    roleId: membership.roleId,
    membershipBrandId: membership.brandId,
    membershipWorkspaceId: membership.workspaceId,
    grants: [
      ...membership.role.grants.map((grant) => ({
        permission: grant.permission,
        effect: grant.effect === "DENY" ? ("deny" as const) : ("allow" as const),
        brandId: membership.role.brandId,
        workspaceId: membership.role.workspaceId,
        roleId: membership.roleId,
      })),
      // Per-member app access (Settings → Users). Scoped like the member's role.
      ...member.grants.map((grant) => ({ ...grant, brandId: membership.role.brandId, workspaceId: membership.role.workspaceId })),
    ],
    exclusions: [
      ...exclusions.map((exclusion) => ({
        permission: exclusion.permission,
        userId: exclusion.userId,
        roleId: exclusion.roleId,
        brandId: exclusion.brandId,
        workspaceId: exclusion.workspaceId,
      })),
      ...member.exclusions,
    ],
    entitledModuleIds: entitledFromState(state),
    permissionModules,
  };
}

/**
 * Full access for the platform SUPER_ADMIN in any organization, even without a
 * membership. The caller must confirm the user is an active SUPER_ADMIN with a
 * 2FA-verified session. Staff blocks and org module toggles still apply; the plan does not.
 */
export async function loadSuperAdminSubject(
  organizationId: string,
  userId: string,
  permissionModules: Readonly<Record<string, string>>,
): Promise<AccessSubject | null> {
  const state = await loadEntitlementState(organizationId);
  if (!state || state.deleted) return null;
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
    entitledModuleIds: superAdminEntitledFromState(state, [...new Set(Object.values(permissionModules))]),
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
