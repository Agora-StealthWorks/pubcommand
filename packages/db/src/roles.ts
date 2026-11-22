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

/**
 * Insert-only: the built-in Owner role (slug "owner", isSystem) holds every permission
 * in the live manifests. Adds what is missing; never removes or changes a grant
 * (an existing DENY row is left alone). Returns how many grants were added.
 */
export async function ensureOwnerPermissions(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  const owner = await tx.role.findUnique({ where: { organizationId_slug: { organizationId, slug: "owner" } }, include: { grants: true } });
  if (!owner || !owner.isSystem) return 0;
  const have = new Set(owner.grants.map((grant) => grant.permission));
  const missing = [...new Set(moduleRegistry.all().flatMap((manifest) => manifest.permissions.map((permission) => permission.key)))].filter(
    (key) => !have.has(key),
  );
  if (missing.length === 0) return 0;
  const result = await tx.rolePermission.createMany({
    data: missing.map((permission) => ({ organizationId, roleId: owner.id, permission, effect: "ALLOW" as const })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Boot step: every organization gets the built-in roles it is missing, and its Owner every permission. */
export async function ensureBuiltInMemberRolesForAll(): Promise<number> {
  return (await ensureBuiltInRolesForAll()).rolesCreated;
}

export async function ensureBuiltInRolesForAll(): Promise<{ rolesCreated: number; ownerGrantsAdded: number }> {
  const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } });
  let rolesCreated = 0;
  let ownerGrantsAdded = 0;
  for (const org of orgs) {
    await rawPrisma().$transaction(async (tx) => {
      rolesCreated += (await ensureBuiltInMemberRoles(tx, org.id)).length;
      ownerGrantsAdded += await ensureOwnerPermissions(tx, org.id);
    });
  }
  return { rolesCreated, ownerGrantsAdded };
}
