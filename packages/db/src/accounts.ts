import {
  PLATFORM_PERMISSIONS,
  PLATFORM_STAFF_MANAGER_EMAIL,
  canManagePlatformStaff,
  parseEmailAddress,
  platformCan,
  selfLockoutMessage,
  type PlatformRole,
} from "@pubcommand/core";
import { rawPrisma } from "./client";
import { normalizeEmail } from "./email";
import { appendPlatformAudit } from "./platform";

async function requireUserManager(actorId: string) {
  const actor = await rawPrisma().user.findUnique({ where: { id: actorId }, include: { staff: true } });
  const role = actor?.staff && !actor.staff.disabledAt ? actor.staff.role : null;
  if (!actor || !platformCan(role, PLATFORM_PERMISSIONS.manageUsers)) {
    throw new Error("You do not have permission.");
  }
  return actor;
}

export async function updateUserProfile(input: { actorId: string; userId: string; name: string; email: string }) {
  await requireUserManager(input.actorId);
  const email = parseEmailAddress(input.email);
  if (!email) throw new Error("Enter an email address.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length > 80) throw new Error("Enter a shorter name.");
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId } });
  if (!target) throw new Error("Unknown account.");
  if (normalizeEmail(target.email) === PLATFORM_STAFF_MANAGER_EMAIL && email !== PLATFORM_STAFF_MANAGER_EMAIL) {
    throw new Error("You cannot change the staff manager email.");
  }
  const collision = await rawPrisma().user.findFirst({
    where: { id: { not: target.id }, email: { equals: email, mode: "insensitive" } },
  });
  if (collision) throw new Error("That email is already in use.");
  const updated = await rawPrisma().user.update({
    where: { id: target.id },
    data: { email, name: name.length > 0 ? name : null },
  });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "user.updated",
    targetType: "user",
    targetId: target.id,
    metadata: { email },
  });
  return { email: updated.email, name: updated.name };
}

export async function setUserPasswordHash(input: { actorId: string; userId: string; passwordHash: string | null }) {
  await requireUserManager(input.actorId);
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId } });
  if (!target) throw new Error("Unknown account.");
  if (input.passwordHash !== null && input.passwordHash.length < 20) throw new Error("Could not save that password.");
  await rawPrisma().user.update({ where: { id: target.id }, data: { passwordHash: input.passwordHash } });
  await rawPrisma().session.deleteMany({ where: { userId: target.id } });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: input.passwordHash ? "user.password.reset" : "user.password.cleared",
    targetType: "user",
    targetId: target.id,
  });
}

export async function resetUserTwoFactor(input: { actorId: string; userId: string }) {
  await requireUserManager(input.actorId);
  const staff = await rawPrisma().platformStaff.findUnique({ where: { userId: input.userId } });
  if (!staff) throw new Error("That account has no authenticator.");
  await rawPrisma().platformStaff.update({
    where: { id: staff.id },
    data: { totpSecretCipher: null, totpConfirmedAt: null },
  });
  await rawPrisma().session.deleteMany({ where: { userId: input.userId } });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "user.totp.reset",
    targetType: "user",
    targetId: input.userId,
  });
}

export async function revokeUserSessions(input: { actorId: string; userId: string }): Promise<number> {
  await requireUserManager(input.actorId);
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!target) throw new Error("Unknown account.");
  const removed = await rawPrisma().session.deleteMany({ where: { userId: target.id } });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "user.sessions.revoked",
    targetType: "user",
    targetId: target.id,
    metadata: { sessions: removed.count },
  });
  return removed.count;
}

/** Sign-out after inactivity for one person. Null = the default (12 hours). */
export async function setUserIdleTimeout(input: { actorId: string; userId: string; minutes: number | null }): Promise<void> {
  await requireUserManager(input.actorId);
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId }, select: { id: true, idleTimeoutMinutes: true } });
  if (!target) throw new Error("Unknown account.");
  await rawPrisma().user.update({ where: { id: target.id }, data: { idleTimeoutMinutes: input.minutes } });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "user.idle_timeout.changed",
    targetType: "user",
    targetId: target.id,
    metadata: { from: target.idleTimeoutMinutes, to: input.minutes },
  });
}

export async function setUserDisabled(input: { actorId: string; userId: string; disabled: boolean }) {
  await requireUserManager(input.actorId);
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId } });
  if (!target) throw new Error("Unknown account.");
  if (input.disabled) {
    const self = selfLockoutMessage({ actorUserId: input.actorId, targetUserId: target.id, action: "disable" });
    if (self) throw new Error(self);
    if (normalizeEmail(target.email) === PLATFORM_STAFF_MANAGER_EMAIL) {
      throw new Error("You cannot disable that account.");
    }
  }
  await rawPrisma().user.update({
    where: { id: target.id },
    data: { disabledAt: input.disabled ? new Date() : null },
  });
  if (input.disabled) await rawPrisma().session.deleteMany({ where: { userId: target.id } });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: input.disabled ? "user.disabled" : "user.enabled",
    targetType: "user",
    targetId: target.id,
  });
}

export async function setPlatformStaffAccess(input: { actorId: string; userId: string; role: PlatformRole | null }) {
  const actor = await rawPrisma().user.findUnique({ where: { id: input.actorId }, include: { staff: true } });
  const actorRole = actor?.staff && !actor.staff.disabledAt ? actor.staff.role : null;
  if (!actor || !canManagePlatformStaff({ email: actor.email, role: actorRole })) {
    throw new Error("Only Stephen can manage staff.");
  }
  const target = await rawPrisma().user.findUnique({ where: { id: input.userId }, include: { staff: true } });
  if (!target) throw new Error("Unknown account.");
  const current = target.staff && !target.staff.disabledAt ? target.staff.role : null;
  if (current === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN") {
    const self = selfLockoutMessage({ actorUserId: actor.id, targetUserId: target.id, action: "demote" });
    if (self) throw new Error(self);
    if (normalizeEmail(target.email) === PLATFORM_STAFF_MANAGER_EMAIL) {
      throw new Error("You cannot change that super admin.");
    }
    const remaining = await rawPrisma().platformStaff.count({
      where: { role: "SUPER_ADMIN", disabledAt: null, userId: { not: target.id } },
    });
    if (remaining < 1) throw new Error("Keep at least one super admin.");
  }
  if (input.role === null) {
    if (!target.staff) throw new Error("That person is not staff.");
    if (target.staff.disabledAt) return;
    await rawPrisma().platformStaff.update({ where: { userId: target.id }, data: { disabledAt: new Date() } });
    await appendPlatformAudit({
      actorId: actor.id,
      action: "staff.removed",
      targetType: "user",
      targetId: target.id,
    });
    return;
  }
  const restoring = !target.staff || Boolean(target.staff.disabledAt);
  if (target.staff) {
    await rawPrisma().platformStaff.update({
      where: { id: target.staff.id },
      data: { role: input.role, disabledAt: null },
    });
  } else {
    await rawPrisma().platformStaff.create({ data: { userId: target.id, role: input.role } });
  }
  await appendPlatformAudit({
    actorId: actor.id,
    action: restoring ? "staff.invited" : "staff.role.changed",
    targetType: "user",
    targetId: target.id,
    metadata: { role: input.role },
  });
}
