import {
  ORG_ADMIN_ROLE_SLUGS,
  PLATFORM_STAFF_MANAGER_EMAIL,
  anonymizedEmail,
  emailConfirmationMatches,
  isAlwaysOnModule,
  organizationConfirmationMatches,
  organizationPurgeDue,
  userDeleteBlocked,
  type AppAccessChoice,
} from "@pubcommand/core";
import type { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";
import { platformTx } from "./entitlements";

/**
 * Platform-staff deletes. Organizations are soft-deleted first (restorable for
 * 30 days) and purged later; accounts are anonymized, never hard-deleted, so
 * rows that point at them (createdById, ownerId…) stay valid.
 * The caller checks the staff permission; these functions check the rest.
 */

type Audit = { actorId: string | null; action: string; targetType: string; targetId: string; metadata?: Prisma.InputJsonValue };

async function bothAudits(tx: Prisma.TransactionClient, organizationId: string | null, entry: Audit) {
  await tx.platformAuditLog.create({ data: { ...entry, metadata: entry.metadata } });
  if (organizationId) {
    await tx.auditLog.create({ data: { organizationId, ...entry, metadata: entry.metadata } });
  }
}

// App access ------------------------------------------------------------------

export async function setOrganizationAppAccess(input: {
  organizationId: string;
  moduleId: string;
  choice: AppAccessChoice;
  actorId: string;
  knownModuleIds: readonly string[];
}): Promise<void> {
  if (!input.knownModuleIds.includes(input.moduleId)) throw new Error("Unknown app.");
  if (isAlwaysOnModule(input.moduleId)) throw new Error("That app is always on.");
  await platformTx(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
    if (!organization) throw new Error("Unknown organization.");
    const before = await tx.organizationAppAccess.findUnique({
      where: { orgId_moduleId: { orgId: organization.id, moduleId: input.moduleId } },
    });
    if (input.choice === "PLAN") {
      await tx.organizationAppAccess.deleteMany({ where: { orgId: organization.id, moduleId: input.moduleId } });
    } else {
      await tx.organizationAppAccess.upsert({
        where: { orgId_moduleId: { orgId: organization.id, moduleId: input.moduleId } },
        create: { orgId: organization.id, moduleId: input.moduleId, access: input.choice, updatedById: input.actorId },
        update: { access: input.choice, updatedById: input.actorId },
      });
    }
    const from = before?.access ?? "PLAN";
    if (from === input.choice) return;
    await bothAudits(tx, organization.id, {
      actorId: input.actorId,
      action: "org.app_access.changed",
      targetType: "module",
      targetId: input.moduleId,
      metadata: { organizationId: organization.id, moduleId: input.moduleId, from, to: input.choice },
    });
  });
}

// Organizations -----------------------------------------------------------------

export async function softDeleteOrganization(input: { organizationId: string; actorId: string; confirm: string }) {
  return rawPrisma().$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new Error("Unknown organization.");
    if (organization.deletedAt) throw new Error("That organization is already deleted.");
    if (!organizationConfirmationMatches(input.confirm, organization)) {
      throw new Error(`Type ${organization.slug} to confirm.`);
    }
    const now = new Date();
    // Also suspend (same timestamp) so every older "is it suspended?" check treats it as off.
    // Restore clears that suspension only when it came from the delete.
    await tx.organization.update({
      where: { id: organization.id },
      data: { deletedAt: now, deletedById: input.actorId, suspendedAt: organization.suspendedAt ?? now },
    });
    await bothAudits(tx, organization.id, {
      actorId: input.actorId,
      action: "org.deleted",
      targetType: "organization",
      targetId: organization.id,
      metadata: { slug: organization.slug, name: organization.name, wasSuspended: Boolean(organization.suspendedAt) },
    });
    return { slug: organization.slug, name: organization.name, deletedAt: now };
  });
}

export async function restoreOrganization(input: { organizationId: string; actorId: string }) {
  return rawPrisma().$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new Error("Unknown organization. It may already have been purged.");
    if (!organization.deletedAt) throw new Error("That organization is not deleted.");
    const suspensionFromDelete = organization.suspendedAt?.getTime() === organization.deletedAt.getTime();
    await tx.organization.update({
      where: { id: organization.id },
      data: { deletedAt: null, deletedById: null, ...(suspensionFromDelete ? { suspendedAt: null } : {}) },
    });
    await bothAudits(tx, organization.id, {
      actorId: input.actorId,
      action: "org.restored",
      targetType: "organization",
      targetId: organization.id,
      metadata: { slug: organization.slug, stillSuspended: !suspensionFromDelete },
    });
    return { slug: organization.slug, name: organization.name };
  });
}

export type PurgeDomain = { id: string; hostname: string; railwayDomainId: string | null; provider: string };
export type DomainDetachResult = { hostname: string; ok: boolean; error?: string };

/** Every public table with an organization_id column (the purge checks each one). */
export async function tablesWithOrganizationId(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
    ORDER BY c.table_name`;
  return rows.map((row) => row.table_name);
}

/**
 * Permanently removes a soft-deleted organization and every tenant row.
 * 1. custom domains are detached from Railway first (best effort, via `detachDomains`);
 *    a domain bought through the registrar keeps its registration;
 * 2. the organization row is deleted (FK cascades remove almost everything);
 * 3. any table with organization_id but no cascading FK is cleaned explicitly;
 * 4. every organization_id table is re-counted and the transaction rolls back if anything is left.
 */
export async function purgeOrganization(input: {
  organizationId: string;
  actorId: string | null;
  /** Manual purge: the typed confirmation. Scheduled purge passes null and must be past the 30 days. */
  confirm: string | null;
  detachDomains?: (domains: PurgeDomain[]) => Promise<DomainDetachResult[]>;
  now?: Date;
}): Promise<{ slug: string; tables: number; domains: DomainDetachResult[]; purchasedDomains: string[] }> {
  const organization = await rawPrisma().organization.findUnique({ where: { id: input.organizationId } });
  if (!organization) throw new Error("Unknown organization.");
  if (!organization.deletedAt) throw new Error("Delete the organization first. Only a deleted organization can be purged.");
  if (input.confirm === null) {
    if (!organizationPurgeDue(organization.deletedAt, input.now)) throw new Error("Not due for purge yet.");
  } else if (!organizationConfirmationMatches(input.confirm, organization)) {
    throw new Error(`Type ${organization.slug} to confirm.`);
  }
  const [domains, purchases] = await platformTx((tx) =>
    Promise.all([
      tx.customDomain.findMany({ where: { organizationId: organization.id }, select: { id: true, hostname: true, railwayDomainId: true, provider: true } }),
      tx.domainPurchase.findMany({ where: { organizationId: organization.id, result: { in: ["SUCCEEDED", "PENDING"] } }, select: { domain: true } }),
    ]),
  );
  let detached: DomainDetachResult[] = [];
  if (domains.length > 0 && input.detachDomains) {
    try {
      detached = await input.detachDomains(domains);
    } catch (error) {
      detached = domains.map((domain) => ({ hostname: domain.hostname, ok: false, error: error instanceof Error ? error.message : "failed" }));
    }
  }
  const purchasedDomains = [...new Set(purchases.map((row) => row.domain))];
  const tables = await rawPrisma().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const names = await tablesWithOrganizationId(tx);
      // memberships → roles is RESTRICT: remove members before their roles go.
      await tx.membership.deleteMany({ where: { organizationId: organization.id } });
      await tx.organization.delete({ where: { id: organization.id } });
      for (const name of names) {
        await tx.$executeRawUnsafe(`DELETE FROM "${name.replace(/"/g, "")}" WHERE organization_id = $1::uuid`, organization.id);
      }
      for (const name of names) {
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "${name.replace(/"/g, "")}" WHERE organization_id = $1::uuid`,
          organization.id,
        );
        if (Number(rows[0]?.n ?? 0) > 0) throw new Error(`Purge left rows in ${name}; nothing was removed.`);
      }
      await tx.platformAuditLog.create({
        data: {
          actorId: input.actorId,
          action: "org.purged",
          targetType: "organization",
          targetId: organization.id,
          metadata: {
            slug: organization.slug,
            name: organization.name,
            mode: input.confirm === null ? "scheduled" : "manual",
            deletedAt: organization.deletedAt?.toISOString() ?? null,
            tablesChecked: names.length,
            domains: detached.map((row) => ({ hostname: row.hostname, detached: row.ok, error: row.error ?? null })),
            registrationsKept: purchasedDomains,
          },
        },
      });
      return names.length;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { slug: organization.slug, tables, domains: detached, purchasedDomains };
}

/** Deleted organizations past their 30 days (for the scheduled purge job). */
export async function organizationsDueForPurge(now = new Date()): Promise<string[]> {
  const rows = await rawPrisma().organization.findMany({ where: { deletedAt: { not: null } }, select: { id: true, deletedAt: true } });
  return rows.filter((row) => organizationPurgeDue(row.deletedAt, now)).map((row) => row.id);
}

// Accounts ----------------------------------------------------------------------

/** Organizations (not deleted) where this user is the only active owner/admin. */
export async function lastAdminOrganizations(userId: string): Promise<{ id: string; name: string; slug: string }[]> {
  const mine = await rawPrisma().membership.findMany({
    where: { userId, status: "ACTIVE", role: { slug: { in: [...ORG_ADMIN_ROLE_SLUGS] } }, organization: { deletedAt: null } },
    select: { organization: { select: { id: true, name: true, slug: true } } },
  });
  const out: { id: string; name: string; slug: string }[] = [];
  for (const row of mine) {
    const others = await rawPrisma().membership.count({
      where: {
        organizationId: row.organization.id,
        userId: { not: userId },
        status: "ACTIVE",
        role: { slug: { in: [...ORG_ADMIN_ROLE_SLUGS] } },
        user: { disabledAt: null },
      },
    });
    if (others === 0) out.push(row.organization);
  }
  return out;
}

export function superAdminEmails(): string[] {
  return [process.env.SUPERADMIN_EMAIL ?? "", PLATFORM_STAFF_MANAGER_EMAIL].map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export async function userDeleteCheck(actorId: string, userId: string): Promise<string | null> {
  const target = await rawPrisma().user.findUnique({ where: { id: userId } });
  if (!target) return "Unknown account.";
  return userDeleteBlocked({
    actorUserId: actorId,
    target: { id: target.id, email: target.email, deleted: Boolean(target.deletedAt) },
    superAdminEmails: superAdminEmails(),
    lastAdminOf: await lastAdminOrganizations(target.id),
  });
}

/**
 * Deletes an account: signs it out everywhere, removes its memberships and staff
 * access, and scrubs its email and name. The row stays (as "Deleted user") so
 * content it created keeps working.
 */
export async function deleteUserAccount(input: { actorId: string; userId: string; confirm: string }) {
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId } });
  if (!target) throw new Error("Unknown account.");
  const blocked = await userDeleteCheck(input.actorId, target.id);
  if (blocked) throw new Error(blocked);
  if (!emailConfirmationMatches(input.confirm, target.email)) throw new Error(`Type ${target.email} to confirm.`);
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    const memberships = await tx.membership.findMany({ where: { userId: target.id }, select: { organizationId: true } });
    const sessions = await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.magicLink.deleteMany({ where: { userId: target.id } });
    await tx.memberAppAccess.deleteMany({ where: { userId: target.id } });
    await tx.membership.deleteMany({ where: { userId: target.id } });
    await tx.platformStaff.updateMany({
      where: { userId: target.id },
      data: { disabledAt: new Date(), totpSecretCipher: null, totpConfirmedAt: null },
    });
    const now = new Date();
    await tx.user.update({
      where: { id: target.id },
      data: { email: anonymizedEmail(target.id), name: null, passwordHash: null, disabledAt: now, deletedAt: now, deletedById: input.actorId },
    });
    await tx.platformAuditLog.create({
      data: {
        actorId: input.actorId,
        action: "user.deleted",
        targetType: "user",
        targetId: target.id,
        metadata: { email: target.email, sessions: sessions.count, organizations: memberships.map((row) => row.organizationId) },
      },
    });
    for (const row of memberships) {
      await tx.auditLog.create({
        data: {
          organizationId: row.organizationId,
          actorId: input.actorId,
          action: "org.member.deleted",
          targetType: "user",
          targetId: target.id,
          metadata: { reason: "Account deleted by PubCommand staff" },
        },
      });
    }
    return { email: target.email, memberships: memberships.length, sessions: sessions.count };
  });
}
