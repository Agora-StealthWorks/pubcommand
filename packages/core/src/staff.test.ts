import { describe, expect, it } from "vitest";
import { PLATFORM_PERMISSIONS, platformCan } from "./platform";
import { canManagePlatformStaff, selfLockoutMessage } from "./staff";

describe("staff lockout", () => {
  it("refuses a super admin who would disable or demote himself", () => {
    expect(selfLockoutMessage({ actorUserId: "stephen", targetUserId: "stephen", action: "disable" })).toBe(
      "You cannot disable your own account.",
    );
    expect(selfLockoutMessage({ actorUserId: "stephen", targetUserId: "stephen", action: "demote" })).toBe(
      "You cannot change your own super admin access.",
    );
    expect(selfLockoutMessage({ actorUserId: "stephen", targetUserId: "ada", action: "disable" })).toBeNull();
    expect(selfLockoutMessage({ actorUserId: "stephen", targetUserId: "ada", action: "demote" })).toBeNull();
  });

  it("lets only Stephen's super admin account manage staff", () => {
    expect(canManagePlatformStaff({ email: "Stephen@onenationfinancial.com", role: "SUPER_ADMIN" })).toBe(true);
    expect(canManagePlatformStaff({ email: "other@onenationfinancial.com", role: "SUPER_ADMIN" })).toBe(false);
    expect(canManagePlatformStaff({ email: "Stephen@onenationfinancial.com", role: "SUPPORT" })).toBe(false);
    expect(canManagePlatformStaff({ email: "Stephen@onenationfinancial.com", role: null })).toBe(false);
    expect(platformCan("SUPER_ADMIN", PLATFORM_PERMISSIONS.manageUsers)).toBe(true);
    expect(platformCan("SUPPORT", PLATFORM_PERMISSIONS.manageUsers)).toBe(false);
    expect(platformCan("BILLING", PLATFORM_PERMISSIONS.manageUsers)).toBe(false);
    expect(platformCan("OPS", PLATFORM_PERMISSIONS.manageUsers)).toBe(false);
    expect(platformCan("SUPPORT", PLATFORM_PERMISSIONS.viewUsers)).toBe(true);
    expect(platformCan(null, PLATFORM_PERMISSIONS.manageUsers)).toBe(false);
  });
});
