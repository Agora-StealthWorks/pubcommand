import { describe, expect, it } from "vitest";
import {
  canAccessPlatformConsole,
  decideAdminAccess,
  platformCan,
  PLATFORM_PERMISSIONS,
} from "./platform";

describe("platform staff", () => {
  it("gives super admins every platform permission and scopes the other roles", () => {
    expect(platformCan("SUPER_ADMIN", PLATFORM_PERMISSIONS.manageStaff)).toBe(true);
    expect(platformCan("SUPPORT", PLATFORM_PERMISSIONS.impersonate)).toBe(true);
    expect(platformCan("SUPPORT", PLATFORM_PERMISSIONS.manageOrgs)).toBe(true);
    expect(platformCan("SUPPORT", PLATFORM_PERMISSIONS.managePlans)).toBe(false);
    expect(platformCan("BILLING", PLATFORM_PERMISSIONS.managePlans)).toBe(true);
    expect(platformCan("BILLING", PLATFORM_PERMISSIONS.manageOrgs)).toBe(false);
    expect(platformCan("BILLING", PLATFORM_PERMISSIONS.suspendOrgs)).toBe(false);
    expect(platformCan("OPS", PLATFORM_PERMISSIONS.manageOrgs)).toBe(true);
    expect(platformCan("OPS", PLATFORM_PERMISSIONS.suspendOrgs)).toBe(true);
    expect(platformCan("OPS", PLATFORM_PERMISSIONS.manageDomains)).toBe(true);
    expect(platformCan("OPS", PLATFORM_PERMISSIONS.manageStaff)).toBe(false);
    expect(platformCan(null, PLATFORM_PERMISSIONS.viewOrgs)).toBe(false);
  });

  it("refuses the console without staff, without enrollment, or without a verified session", () => {
    expect(
      canAccessPlatformConsole({
        role: null,
        disabled: false,
        totpConfirmed: true,
        mfaVerified: true,
      }),
    ).toBe(false);
    expect(
      canAccessPlatformConsole({
        role: "SUPER_ADMIN",
        disabled: true,
        totpConfirmed: true,
        mfaVerified: true,
      }),
    ).toBe(false);
    expect(
      canAccessPlatformConsole({
        role: "SUPER_ADMIN",
        disabled: false,
        totpConfirmed: false,
        mfaVerified: false,
      }),
    ).toBe(false);
    expect(
      canAccessPlatformConsole({
        role: "SUPER_ADMIN",
        disabled: false,
        totpConfirmed: true,
        mfaVerified: false,
      }),
    ).toBe(false);
    expect(
      canAccessPlatformConsole({
        role: "SUPPORT",
        disabled: false,
        totpConfirmed: true,
        mfaVerified: true,
      }),
    ).toBe(true);
  });

  it("rejects a non-staff session on the admin host and holds staff at 2FA", () => {
    expect(
      decideAdminAccess({ pathname: "/orgs", hasSession: true, staffRole: null, mfaVerified: false }),
    ).toEqual({ type: "reject" });
    expect(
      decideAdminAccess({ pathname: "/orgs", hasSession: false, staffRole: null, mfaVerified: false }),
    ).toEqual({ type: "login" });
    expect(
      decideAdminAccess({ pathname: "/login", hasSession: false, staffRole: null, mfaVerified: false }),
    ).toEqual({ type: "allow" });
    expect(
      decideAdminAccess({ pathname: "/reset-password", hasSession: false, staffRole: null, mfaVerified: false }),
    ).toEqual({ type: "allow" });
    expect(
      decideAdminAccess({ pathname: "/api/auth/password-reset", hasSession: false, staffRole: null, mfaVerified: false }),
    ).toEqual({ type: "allow" });
    expect(
      decideAdminAccess({
        pathname: "/orgs",
        hasSession: true,
        staffRole: "SUPER_ADMIN",
        mfaVerified: false,
      }),
    ).toEqual({ type: "mfa" });
    expect(
      decideAdminAccess({
        pathname: "/2fa",
        hasSession: true,
        staffRole: "SUPER_ADMIN",
        mfaVerified: false,
      }),
    ).toEqual({ type: "allow" });
    expect(
      decideAdminAccess({
        pathname: "/",
        hasSession: true,
        staffRole: "OPS",
        mfaVerified: true,
      }),
    ).toEqual({ type: "allow" });
  });
});

describe("main Brain permission", () => {
  it("is held by SUPER_ADMIN and OPS only", () => {
    expect(platformCan("SUPER_ADMIN", "platform.brain.manage")).toBe(true);
    expect(platformCan("OPS", "platform.brain.manage")).toBe(true);
    expect(platformCan("SUPPORT", "platform.brain.manage")).toBe(false);
    expect(platformCan("BILLING", "platform.brain.manage")).toBe(false);
    expect(platformCan(null, "platform.brain.manage")).toBe(false);
  });
});
