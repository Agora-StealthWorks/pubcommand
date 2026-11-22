import { cleanDisplayName, memberPasswordBlocked } from "@pubcommand/core";
import { appendOrgAudit } from "./access";
import { rawPrisma } from "./client";
import { normalizeEmail } from "./email";
import { superAdminEmails } from "./lifecycle";
import { appendPlatformAudit } from "./platform";

/**
 * Passwords set from inside an organization: a person changing their own
 * ("Your account") and an org admin setting a member's (Settings → Users).
 * Callers hash the password; nothing here ever sees or logs the plain text.
 */

function checkHash(passwordHash: string) {
  if (passwordHash.length < 20) throw new Error("Could not save that password.");
}

/** The facts memberPasswordBlocked() needs, looked up across organizations. */
export async function memberPasswordFacts(organizationId: string, targetUserId: string) {
  const target = await rawPrisma().user.findUnique({
    where: { id: targetUserId },
    include: { staff: true, memberships: { where: { status: { in: ["ACTIVE", "INVITED"] }, organization: { deletedAt: null } } } },
  });
  if (!target) {
    return { targetIsMember: false, targetIsStaff: false, targetOtherOrganizations: 0, targetDisabled: false };
  }
  return {
    targetIsMember: target.memberships.some((membership) => membership.organizationId === organizationId),
    // Any staff row (even turned off) or a configured super admin email: the platform console owns those accounts.
    targetIsStaff: Boolean(target.staff) || superAdminEmails().includes(normalizeEmail(target.email)),
    targetOtherOrganizations: target.memberships.filter((membership) => membership.organizationId !== organizationId).length,
    targetDisabled: Boolean(target.disabledAt || target.deletedAt),
  };
}

/** An org admin sets a member's password. Re-checks every guard, signs the member out everywhere, audits without the password. */
export async function setMemberPassword(input: {
  organizationId: string;
  actorId: string;
  actorCanManageUsers: boolean;
  impersonating: boolean;
  targetUserId: string;
  passwordHash: string;
}): Promise<{ sessionsSignedOut: number }> {
  const facts = await memberPasswordFacts(input.organizationId, input.targetUserId);
  const blocked = memberPasswordBlocked({
    actorUserId: input.actorId,
    targetUserId: input.targetUserId,
    actorCanManageUsers: input.actorCanManageUsers,
    impersonating: input.impersonating,
    ...facts,
  });
  if (blocked) throw new Error(blocked);
  checkHash(input.passwordHash);
  const removed = await rawPrisma().$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.targetUserId }, data: { passwordHash: input.passwordHash } });
    return tx.session.deleteMany({ where: { userId: input.targetUserId } });
  });
  const metadata = { organizationId: input.organizationId, sessionsSignedOut: removed.count };
  await appendOrgAudit(input.organizationId, {
    actorId: input.actorId,
    action: "member.password.set",
    targetType: "user",
    targetId: input.targetUserId,
    metadata: { sessionsSignedOut: removed.count },
  });
  await appendPlatformAudit({ actorId: input.actorId, action: "member.password.set", targetType: "user", targetId: input.targetUserId, metadata });
  return { sessionsSignedOut: removed.count };
}

/** Someone changes their own password. Every other session of theirs is signed out; this one stays. */
export async function changeOwnPassword(input: {
  userId: string;
  passwordHash: string;
  keepSessionId: string;
  organizationId: string | null;
  firstPassword: boolean;
}): Promise<{ sessionsSignedOut: number }> {
  checkHash(input.passwordHash);
  const removed = await rawPrisma().$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash: input.passwordHash } });
    return tx.session.deleteMany({ where: { userId: input.userId, id: { not: input.keepSessionId } } });
  });
  const action = input.firstPassword ? "account.password.created" : "account.password.changed";
  if (input.organizationId) {
    await appendOrgAudit(input.organizationId, {
      actorId: input.userId,
      action,
      targetType: "user",
      targetId: input.userId,
      metadata: { sessionsSignedOut: removed.count },
    });
  }
  await appendPlatformAudit({
    actorId: input.userId,
    action,
    targetType: "user",
    targetId: input.userId,
    metadata: { sessionsSignedOut: removed.count, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
  });
  return { sessionsSignedOut: removed.count };
}

/** Someone edits their own display name. */
export async function updateOwnName(input: { userId: string; name: string; organizationId: string | null }): Promise<string | null> {
  const cleaned = cleanDisplayName(input.name);
  if (cleaned.error) throw new Error(cleaned.error);
  const before = await rawPrisma().user.findUnique({ where: { id: input.userId }, select: { name: true } });
  if (!before) throw new Error("Unknown account.");
  if ((before.name ?? null) === cleaned.name) return cleaned.name;
  await rawPrisma().user.update({ where: { id: input.userId }, data: { name: cleaned.name } });
  if (input.organizationId) {
    await appendOrgAudit(input.organizationId, { actorId: input.userId, action: "account.name.changed", targetType: "user", targetId: input.userId });
  }
  return cleaned.name;
}
