import type { ClassifiedPermission } from "./member-access";

/**
 * Per-app access levels for a role (Settings → Roles & access). A level is just
 * a named set of the app's permissions, built from the read / write / admin
 * classification in member-access.ts, so the stored role_permissions rows and
 * `can()` stay the only source of truth.
 *   NONE   → none of the app's permissions
 *   VIEW   → its read permissions
 *   EDIT   → its read and write permissions
 *   MANAGE → every permission of the app, including admin-only ones
 * Any other combination reads back as CUSTOM (set in "Advanced").
 */
export type RoleAppLevel = "NONE" | "VIEW" | "EDIT" | "MANAGE";
export type RoleAppLevelState = RoleAppLevel | "CUSTOM";

export const ROLE_APP_LEVEL_LABELS: Record<RoleAppLevelState, string> = {
  NONE: "No access",
  VIEW: "View",
  EDIT: "Edit",
  MANAGE: "Manage",
  CUSTOM: "Custom",
};

export function isRoleAppLevel(value: string): value is RoleAppLevel {
  return value === "NONE" || value === "VIEW" || value === "EDIT" || value === "MANAGE";
}

function appPermissions(moduleId: string, classified: readonly ClassifiedPermission[]) {
  return classified.filter((permission) => permission.moduleId === moduleId);
}

/** The levels that make sense for an app, lowest first. Levels that would equal a lower one are left out. */
export function roleAppLevelOptions(moduleId: string, classified: readonly ClassifiedPermission[]): RoleAppLevel[] {
  const perms = appPermissions(moduleId, classified);
  if (perms.length === 0) return [];
  const options: RoleAppLevel[] = ["NONE"];
  if (perms.some((permission) => permission.access === "read")) options.push("VIEW");
  if (perms.some((permission) => permission.access === "write")) options.push("EDIT");
  if (perms.some((permission) => permission.access === "admin")) options.push("MANAGE");
  return options;
}

/** The exact permission keys a level stands for in one app. */
export function roleAppLevelPermissions(moduleId: string, level: RoleAppLevel, classified: readonly ClassifiedPermission[]): string[] {
  const perms = appPermissions(moduleId, classified);
  const included = (access: ClassifiedPermission["access"]) =>
    level === "MANAGE" || (level === "EDIT" && access !== "admin") || (level === "VIEW" && access === "read");
  return perms.filter((permission) => level !== "NONE" && included(permission.access)).map((permission) => permission.key).sort();
}

/** Which level a role's grants amount to for one app, or CUSTOM when they match none exactly. */
export function roleAppLevel(moduleId: string, granted: (permission: string) => boolean, classified: readonly ClassifiedPermission[]): RoleAppLevelState {
  const perms = appPermissions(moduleId, classified);
  const have = perms.filter((permission) => granted(permission.key)).map((permission) => permission.key).sort();
  for (const level of roleAppLevelOptions(moduleId, classified)) {
    const want = roleAppLevelPermissions(moduleId, level, classified);
    if (want.length === have.length && want.every((key, index) => key === have[index])) return level;
  }
  return perms.length === 0 ? "NONE" : "CUSTOM";
}

/**
 * What to add and remove so a role holds exactly `desired` among `sectionKeys`.
 * Keys outside the section are never touched; unknown desired keys are ignored.
 */
export function roleGrantChanges(input: {
  current: readonly string[];
  desired: readonly string[];
  sectionKeys: readonly string[];
}): { add: string[]; remove: string[] } {
  const section = new Set(input.sectionKeys);
  const current = new Set(input.current.filter((key) => section.has(key)));
  const desired = new Set(input.desired.filter((key) => section.has(key)));
  return {
    add: [...desired].filter((key) => !current.has(key)).sort(),
    remove: [...current].filter((key) => !desired.has(key)).sort(),
  };
}

/** Permissions an admin may never take away from their own role, so nobody locks themselves out of Settings. */
export const SELF_LOCKOUT_PERMISSIONS: readonly string[] = ["settings.roles.manage", "settings.users.manage"];

/** Roles whose grants nobody edits here. The Owner always has everything. */
export const LOCKED_ROLE_SLUGS: readonly string[] = ["owner"];

/** Guard for saving a role's grants. Returns a message, or null when allowed. */
export function roleGrantChangeBlocked(input: { roleSlug: string; isActorsRole: boolean; remove: readonly string[] }): string | null {
  if (LOCKED_ROLE_SLUGS.includes(input.roleSlug)) return "The Owner role always has every permission and cannot be changed.";
  if (input.isActorsRole && input.remove.some((key) => SELF_LOCKOUT_PERMISSIONS.includes(key))) {
    return "You cannot take away your own role's ability to manage users and roles. Ask another admin to do it.";
  }
  return null;
}
