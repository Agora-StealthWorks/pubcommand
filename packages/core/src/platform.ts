export const PLATFORM_ROLES = ["SUPER_ADMIN", "SUPPORT", "BILLING", "OPS"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = {
  viewOrgs: "platform.orgs.view",
  viewUsers: "platform.users.view",
  manageUsers: "platform.users.manage",
  impersonate: "platform.orgs.impersonate",
  manageOrgs: "platform.orgs.manage",
  managePlans: "platform.plans.manage",
  suspendOrgs: "platform.orgs.suspend",
  manageDomains: "platform.domains.manage",
  manageModules: "platform.modules.manage",
  manageStaff: "platform.staff.manage",
  viewAudit: "platform.audit.view",
  manageJobs: "platform.jobs.manage",
  /** The main Brain: platform-level knowledge, learning provenance and push-down to brands. */
  manageBrain: "platform.brain.manage",
  /** Delete, restore and purge organizations, delete accounts, remove domains. Super admin only. */
  deleteData: "platform.data.delete",
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = Object.values(PLATFORM_PERMISSIONS);

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  SUPER_ADMIN: ALL_PLATFORM_PERMISSIONS,
  SUPPORT: [
    PLATFORM_PERMISSIONS.viewOrgs,
    PLATFORM_PERMISSIONS.viewUsers,
    PLATFORM_PERMISSIONS.impersonate,
    PLATFORM_PERMISSIONS.manageOrgs,
    PLATFORM_PERMISSIONS.viewAudit,
  ],
  BILLING: [
    PLATFORM_PERMISSIONS.viewOrgs,
    PLATFORM_PERMISSIONS.managePlans,
    PLATFORM_PERMISSIONS.viewAudit,
  ],
  OPS: [
    PLATFORM_PERMISSIONS.viewOrgs,
    PLATFORM_PERMISSIONS.manageOrgs,
    PLATFORM_PERMISSIONS.suspendOrgs,
    PLATFORM_PERMISSIONS.manageDomains,
    PLATFORM_PERMISSIONS.manageModules,
    PLATFORM_PERMISSIONS.viewAudit,
    PLATFORM_PERMISSIONS.manageJobs,
    PLATFORM_PERMISSIONS.manageBrain,
  ],
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Platform staff permissions. Org roles never grant these. */
export function platformCan(role: PlatformRole | null, permission: string): boolean {
  if (!role) return false;
  return PLATFORM_ROLE_PERMISSIONS[role].some((candidate) => candidate === permission);
}

export function platformPermissionsFor(role: PlatformRole): readonly PlatformPermission[] {
  return PLATFORM_ROLE_PERMISSIONS[role];
}

/**
 * Console access requires a platform staff role, an active staff row, confirmed
 * TOTP enrollment, and a session that passed the authenticator challenge.
 * A matching email without a staff row is not enough.
 */
export function canAccessPlatformConsole(input: {
  role: PlatformRole | null;
  disabled: boolean;
  totpConfirmed: boolean;
  mfaVerified: boolean;
}): boolean {
  if (!input.role || input.disabled) return false;
  if (!input.totpConfirmed || !input.mfaVerified) return false;
  return true;
}

export type AdminAccessDecision =
  | { type: "allow" }
  | { type: "login" }
  | { type: "mfa" }
  /** Signed in but the staff pass cookie is missing or expired: re-check staff and reissue it. */
  | { type: "refresh" }
  | { type: "reject" };

function pathIs(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Middleware decision for admin.{root}. Sessions that are not platform staff
 * are rejected. Staff who have not completed 2FA only reach the enrollment gate.
 */
export function decideAdminAccess(input: {
  pathname: string;
  hasSession: boolean;
  staffRole: PlatformRole | null;
  mfaVerified: boolean;
  /** True when a pass refresh was just attempted, so a failed refresh cannot loop. */
  gateRetried?: boolean;
}): AdminAccessDecision {
  if (pathIs(input.pathname, "/api/auth") || input.pathname === "/api/health") {
    return { type: "allow" };
  }
  if (!input.staffRole) {
    // Signing in and "Forgot your password?" work on every host, including this one.
    if (input.pathname === "/login" || input.pathname === "/reset-password") return { type: "allow" };
    if (!input.hasSession) return { type: "login" };
    // The staff pass expires after 12 h but the session lasts 30 days. A signed-in
    // visitor without a pass gets one reissued after a database staff check, rather
    // than a flat refusal. API calls cannot follow that redirect, so they are refused.
    if (!input.gateRetried && !pathIs(input.pathname, "/api")) return { type: "refresh" };
    return { type: "reject" };
  }
  if (!input.mfaVerified) {
    if (pathIs(input.pathname, "/2fa")) return { type: "allow" };
    return { type: "mfa" };
  }
  return { type: "allow" };
}
