import { Prisma } from "@prisma/client";
import {
  AGENT_EMAIL_DOMAIN,
  defaultOrganizationPlaces,
  firstAdminMembershipStatus,
  organizationAdminRoleGrants,
  parseEmailAddress,
  validateOrganizationDraft,
} from "@pubcommand/core";
import { rawPrisma } from "./client";
import { slugAvailability } from "./platform";
import { ensureBuiltInMemberRoles, ensureOwnerPermissions } from "./roles";

type AuditInput = {
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

async function writeAudits(tx: Prisma.TransactionClient, entry: AuditInput) {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
    },
  });
  await tx.platformAuditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
    },
  });
}

function rethrow(error: unknown, fallback: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta?.target ?? "");
    if (target.includes("email")) throw new Error("That email is already in use.");
    throw new Error("That slug is already in use.");
  }
  if (error instanceof Error && error.message.length > 0 && error.message.length < 160 && !/prisma|database|invocation/i.test(error.message)) {
    throw error;
  }
  throw new Error(fallback);
}

/** People holding a seat. AI agents (AI Agents) never take one. */
async function occupyingSeats(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.membership.count({
    where: { organizationId, status: { in: ["ACTIVE", "INVITED"] }, user: { email: { not: { endsWith: `@${AGENT_EMAIL_DOMAIN}` } } } },
  });
}

export type ProvisionedOrganization = {
  organizationId: string;
  name: string;
  slug: string;
  userId: string;
  adminEmail: string;
  membershipStatus: "ACTIVE" | "INVITED";
};

export async function provisionOrganization(input: {
  name: string;
  slug: string;
  planId: string;
  adminEmail: string;
  actorId: string;
  actorEmail: string;
  permissionKeys: readonly string[];
}): Promise<ProvisionedOrganization> {
  const draft = validateOrganizationDraft(input);
  if (!draft.ok) throw new Error(draft.message);
  const availability = await slugAvailability(draft.slug);
  if (!availability.available) {
    if (availability.reason === "reserved") throw new Error("That subdomain is reserved.");
    if (availability.reason === "taken" || availability.reason === "history") throw new Error("That slug is already in use.");
    throw new Error("Use 3-40 lowercase letters, numbers, or hyphens.");
  }
  const status = firstAdminMembershipStatus(draft.adminEmail, input.actorEmail);
  try {
    return await rawPrisma().$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: draft.planId }, include: { modules: true } });
      if (!plan || plan.archivedAt) throw new Error("Choose a plan.");
      if (plan.seatLimit < 1) throw new Error("That plan has no seats.");
      const taken = await tx.organization.findUnique({ where: { slug: draft.slug } });
      if (taken) throw new Error("That slug is already in use.");
      const history = await tx.organizationSlugHistory.findUnique({ where: { slug: draft.slug } });
      if (history) throw new Error("That slug is already in use.");
      const places = defaultOrganizationPlaces(draft.name);
      const organization = await tx.organization.create({
        data: {
          name: draft.name,
          slug: draft.slug,
          planId: plan.id,
          seatLimit: plan.seatLimit,
        },
      });
      await tx.orgSettings.create({
        data: {
          organizationId: organization.id,
          displayName: draft.name,
          timezone: "America/New_York",
          supportEmail: draft.adminEmail,
        },
      });
      const brand = await tx.brand.create({
        data: { organizationId: organization.id, name: places.brand.name, slug: places.brand.slug },
      });
      await tx.workspace.create({
        data: {
          organizationId: organization.id,
          brandId: brand.id,
          name: places.workspace.name,
          slug: places.workspace.slug,
        },
      });
      const moduleIds = new Set(plan.modules.map((row) => row.moduleId));
      moduleIds.add("settings");
      await tx.organizationModule.createMany({
        data: [...moduleIds].map((moduleId) => ({ organizationId: organization.id, moduleId, enabled: true })),
      });
      const roles = new Map<string, string>();
      for (const role of organizationAdminRoleGrants(input.permissionKeys)) {
        const created = await tx.role.create({
          data: {
            organizationId: organization.id,
            slug: role.slug,
            name: role.name,
            isSystem: true,
          },
        });
        roles.set(role.slug, created.id);
        if (role.permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: role.permissions.map((permission) => ({
              organizationId: organization.id,
              roleId: created.id,
              permission,
              effect: "ALLOW" as const,
            })),
          });
        }
      }
      await ensureBuiltInMemberRoles(tx, organization.id);
      await ensureOwnerPermissions(tx, organization.id);
      const ownerRoleId = roles.get("owner");
      if (!ownerRoleId) throw new Error("Could not save the organization.");
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: draft.adminEmail, mode: "insensitive" } },
      });
      const user = existingUser ?? (await tx.user.create({ data: { email: draft.adminEmail, passwordHash: null } }));
      await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          roleId: ownerRoleId,
          status,
        },
      });
      await writeAudits(tx, {
        organizationId: organization.id,
        actorId: input.actorId,
        action: "org.created",
        targetType: "organization",
        targetId: organization.id,
        metadata: { slug: organization.slug, plan: plan.key, adminEmail: draft.adminEmail, role: "owner" },
      });
      return {
        organizationId: organization.id,
        name: organization.name,
        slug: organization.slug,
        userId: user.id,
        adminEmail: draft.adminEmail,
        membershipStatus: status,
      };
    });
  } catch (error) {
    rethrow(error, "Could not create the organization.");
  }
}

async function ensureAdminRole(tx: Prisma.TransactionClient, organizationId: string, permissionKeys: readonly string[]) {
  const existing = await tx.role.findUnique({
    where: { organizationId_slug: { organizationId, slug: "admin" } },
  });
  if (existing) return existing;
  const role = await tx.role.create({
    data: { organizationId, slug: "admin", name: "Admin", isSystem: true },
  });
  const permissions = [...new Set(permissionKeys)];
  if (permissions.length > 0) {
    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({
        organizationId,
        roleId: role.id,
        permission,
        effect: "ALLOW" as const,
      })),
    });
  }
  return role;
}

export async function addStaffAsOrganizationAdmin(input: {
  organizationId: string;
  userId: string;
  actorId: string;
  permissionKeys: readonly string[];
}): Promise<{ changed: boolean }> {
  try {
    return await rawPrisma().$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization) throw new Error("Unknown organization.");
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new Error("Unknown account.");
      const role = await ensureAdminRole(tx, organization.id, input.permissionKeys);
      const existing = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        include: { role: true },
      });
      if (existing?.status === "ACTIVE" && (existing.role.slug === "admin" || existing.role.slug === "owner")) {
        return { changed: false };
      }
      if (!existing || existing.status === "DISABLED") {
        const used = await occupyingSeats(tx, organization.id);
        if (used >= organization.seatLimit) throw new Error("This organization has no open seats.");
      }
      await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        create: { organizationId: organization.id, userId: user.id, roleId: role.id, status: "ACTIVE" },
        update: { roleId: role.id, status: "ACTIVE" },
      });
      await writeAudits(tx, {
        organizationId: organization.id,
        actorId: input.actorId,
        action: "org.member.added",
        targetType: "user",
        targetId: user.id,
        metadata: { email: user.email, role: "admin" },
      });
      return { changed: true };
    });
  } catch (error) {
    rethrow(error, "Could not add you to the organization.");
  }
}

export async function addOrganizationMember(input: {
  organizationId: string;
  email: string;
  roleId: string;
  actorId: string;
}): Promise<{ userId: string; email: string; status: "ACTIVE" | "INVITED" }> {
  const email = parseEmailAddress(input.email);
  if (!email) throw new Error("Enter an email address.");
  try {
    return await rawPrisma().$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization) throw new Error("Unknown organization.");
      const role = await tx.role.findFirst({ where: { id: input.roleId, organizationId: organization.id } });
      if (!role) throw new Error("Choose a role.");
      const existingUser = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
      const user = existingUser ?? (await tx.user.create({ data: { email, passwordHash: null } }));
      const existing = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      });
      const status = existing?.status === "ACTIVE" ? "ACTIVE" : "INVITED";
      if (!existing || existing.status === "DISABLED") {
        const used = await occupyingSeats(tx, organization.id);
        if (used >= organization.seatLimit) throw new Error("This organization has no open seats.");
      }
      await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        create: { organizationId: organization.id, userId: user.id, roleId: role.id, status },
        update: { roleId: role.id, status },
      });
      await writeAudits(tx, {
        organizationId: organization.id,
        actorId: input.actorId,
        action: status === "ACTIVE" ? "org.member.updated" : "org.member.invited",
        targetType: "user",
        targetId: user.id,
        metadata: { email: user.email, role: role.slug },
      });
      return { userId: user.id, email: user.email, status };
    });
  } catch (error) {
    rethrow(error, "Could not add that member.");
  }
}

export async function removeOrganizationMember(input: {
  organizationId: string;
  membershipId: string;
  actorId: string;
}): Promise<void> {
  try {
    await rawPrisma().$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: input.membershipId, organizationId: input.organizationId },
        include: { user: true },
      });
      if (!membership) throw new Error("Unknown member.");
      if (membership.status === "DISABLED") throw new Error("That member is already removed.");
      await tx.membership.update({ where: { id: membership.id }, data: { status: "DISABLED" } });
      await writeAudits(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "org.member.removed",
        targetType: "user",
        targetId: membership.userId,
        metadata: { email: membership.user.email },
      });
    });
  } catch (error) {
    rethrow(error, "Could not remove that member.");
  }
}

export async function changeOrganizationMemberRole(input: {
  organizationId: string;
  membershipId: string;
  roleId: string;
  actorId: string;
}): Promise<void> {
  try {
    await rawPrisma().$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: input.membershipId, organizationId: input.organizationId },
        include: { user: true },
      });
      if (!membership || membership.status === "DISABLED") throw new Error("Unknown member.");
      const role = await tx.role.findFirst({ where: { id: input.roleId, organizationId: input.organizationId } });
      if (!role) throw new Error("Choose a role.");
      if (membership.roleId === role.id) return;
      await tx.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
      await writeAudits(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "org.member.role",
        targetType: "membership",
        targetId: membership.id,
        metadata: { email: membership.user.email, role: role.slug },
      });
    });
  } catch (error) {
    rethrow(error, "Could not change that role.");
  }
}

export async function assignOrganizationPlan(input: {
  organizationId: string;
  planId: string;
  actorId: string;
}): Promise<{ key: string; name: string }> {
  try {
    return await rawPrisma().$transaction(async (tx) => {
      const [organization, plan] = await Promise.all([
        tx.organization.findUnique({ where: { id: input.organizationId } }),
        tx.plan.findUnique({ where: { id: input.planId } }),
      ]);
      if (!organization) throw new Error("Unknown organization.");
      if (!plan || (plan.archivedAt && plan.id !== organization.planId)) throw new Error("Unknown plan.");
      await tx.organization.update({
        where: { id: organization.id },
        data: { planId: plan.id, seatLimit: plan.seatLimit },
      });
      await writeAudits(tx, {
        organizationId: organization.id,
        actorId: input.actorId,
        action: "org.plan.changed",
        targetType: "organization",
        targetId: organization.id,
        metadata: { plan: plan.key },
      });
      return { key: plan.key, name: plan.name };
    });
  } catch (error) {
    rethrow(error, "Could not change the plan.");
  }
}

export async function setOrganizationSuspended(input: {
  organizationId: string;
  suspend: boolean;
  actorId: string;
}): Promise<void> {
  try {
    await rawPrisma().$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization) throw new Error("Unknown organization.");
      if (organization.deletedAt) throw new Error("That organization is deleted. Restore it first.");
      await tx.organization.update({
        where: { id: organization.id },
        data: { suspendedAt: input.suspend ? new Date() : null },
      });
      await writeAudits(tx, {
        organizationId: organization.id,
        actorId: input.actorId,
        action: input.suspend ? "org.suspended" : "org.unsuspended",
        targetType: "organization",
        targetId: organization.id,
      });
    });
  } catch (error) {
    rethrow(error, "Could not update the organization.");
  }
}

export async function activateInvitedMemberships(userId: string): Promise<string[]> {
  const pending = await rawPrisma().membership.findMany({
    where: { userId, status: "INVITED" },
    select: { id: true, organizationId: true },
  });
  if (pending.length === 0) return [];
  await rawPrisma().membership.updateMany({
    where: { id: { in: pending.map((row) => row.id) } },
    data: { status: "ACTIVE" },
  });
  for (const row of pending) {
    await rawPrisma().auditLog.create({
      data: {
        organizationId: row.organizationId,
        actorId: userId,
        action: "org.member.activated",
        targetType: "membership",
        targetId: row.id,
      },
    });
  }
  return pending.map((row) => row.organizationId);
}
