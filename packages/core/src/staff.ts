import type { PlatformRole } from "./platform";

/** The only account allowed to add, remove, or change platform staff. */
export const PLATFORM_STAFF_MANAGER_EMAIL = "stephen@onenationfinancial.com";

export function canManagePlatformStaff(input: { email: string; role: PlatformRole | null }): boolean {
  if (input.role !== "SUPER_ADMIN") return false;
  return input.email.trim().toLowerCase() === PLATFORM_STAFF_MANAGER_EMAIL;
}

export function selfLockoutMessage(input: {
  actorUserId: string;
  targetUserId: string;
  action: "disable" | "demote";
}): string | null {
  if (input.actorUserId !== input.targetUserId) return null;
  if (input.action === "disable") return "You cannot disable your own account.";
  return "You cannot change your own super admin access.";
}
