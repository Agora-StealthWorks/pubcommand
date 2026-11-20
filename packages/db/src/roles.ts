import { BUILT_IN_MEMBER_ROLES, builtInRolePermissions } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import type { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";

/**
 * Create-only: gives an organization the built-in User and Editor roles when a
 * role with that slug does not exist yet. Never edits an existing role, its
 * grants, or anyone's membership (org admins own their roles after creation).
 */
export async function ensureBuiltInMemberRoles(tx: Prisma.TransactionClient, organizationId: string): Promise<string[]> {
  const created: string[] = [];
  for (const role of BUILT_IN_MEMBER_ROLES) {
    const existing = await tx.role.findUnique({ where: { organizationId_slug: { organizationId, slug: role.slug } } });
    if (existing) continue;
    const row = await tx.role.create({
      data: { organizationId, slug: role.slug, name: role.name, description: role.description, isSystem: true },
    });
    const permissions = builtInRolePermissions(role.slug, moduleRegistry.all());
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ organizationId, roleId: row.id, permission, effect: "ALLOW" as const })),
      });
    }
    created.push(role.slug);
  }
  return created;
}

/** Boot step: every organization gets the built-in roles it is missing. */
export async function ensureBuiltInMemberRolesForAll(): Promise<number> {
  const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } });
  let created = 0;
  for (const org of orgs) {
    created += (await rawPrisma().$transaction((tx) => ensureBuiltInMemberRoles(tx, org.id))).length;
  }
  return created;
}
