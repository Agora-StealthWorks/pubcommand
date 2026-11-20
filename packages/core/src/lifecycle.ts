/**
 * Pure rules for deleting organizations and accounts from the platform console.
 * The database code in packages/db calls these, and the tests pin them down.
 */

/** Deleted organizations can be restored for this many days, then they are purged. */
export const ORGANIZATION_RESTORE_DAYS = 30;

export function organizationPurgeDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + ORGANIZATION_RESTORE_DAYS * 24 * 60 * 60 * 1000);
}

export function organizationPurgeDue(deletedAt: Date | null, now = new Date()): boolean {
  return Boolean(deletedAt) && organizationPurgeDate(deletedAt as Date).getTime() <= now.getTime();
}

/** The typed confirmation must equal the slug or the exact name (spaces trimmed, slug case-insensitive). */
export function organizationConfirmationMatches(typed: string, organization: { slug: string; name: string }): boolean {
  const value = typed.trim();
  if (!value) return false;
  return value.toLowerCase() === organization.slug.toLowerCase() || value === organization.name.trim();
}

export function emailConfirmationMatches(typed: string, email: string): boolean {
  const value = typed.trim().toLowerCase();
  return value.length > 0 && value === email.trim().toLowerCase();
}

export function hostnameConfirmationMatches(typed: string, hostname: string): boolean {
  const value = typed.trim().toLowerCase().replace(/\.$/, "");
  return value.length > 0 && value === hostname.toLowerCase();
}

export type UserDeleteCheck = {
  actorUserId: string;
  target: { id: string; email: string; deleted: boolean };
  superAdminEmails: readonly string[];
  /** Organizations (not deleted) where the target is the only active owner/admin. */
  lastAdminOf: readonly { name: string; slug: string }[];
};

/** Why a user cannot be deleted, or null when it is allowed. */
export function userDeleteBlocked(check: UserDeleteCheck): string | null {
  if (check.target.deleted) return "That account is already deleted.";
  if (check.actorUserId === check.target.id) return "You cannot delete your own account.";
  const email = check.target.email.trim().toLowerCase();
  if (check.superAdminEmails.some((value) => value.trim().toLowerCase() === email)) {
    return "You cannot delete the configured super admin.";
  }
  if (check.lastAdminOf.length > 0) {
    const names = check.lastAdminOf.map((org) => `${org.name} (${org.slug})`).join(", ");
    return `This person is the last admin of ${names}. Make someone else an admin there first.`;
  }
  return null;
}

/** The scrubbed email a deleted account keeps, so the unique email is freed and nothing can sign in as it. */
export function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

/** Roles that count as an organization admin for the last-admin rule. */
export const ORG_ADMIN_ROLE_SLUGS: readonly string[] = ["owner", "admin"];
