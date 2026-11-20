import type { ModuleManifest, PermissionAccess } from "./modules";
import type { AccessExclusion, AccessGrant } from "./permissions";

/**
 * Read vs write classification, built-in User / Editor roles, and per-member app access.
 * This is the one place that decides what "read-only" means.
 */

type PermissionDef = ModuleManifest["permissions"][number];

/** A manifest's explicit `access` wins; otherwise `.read` / `.view` keys are read and everything else is write. */
export function permissionAccess(permission: PermissionDef): PermissionAccess {
  if (permission.access) return permission.access;
  return /\.(read|view)$/.test(permission.key) ? "read" : "write";
}

export type ClassifiedPermission = { key: string; moduleId: string; access: PermissionAccess };

export function classifyPermissions(manifests: readonly ModuleManifest[]): ClassifiedPermission[] {
  return manifests.flatMap((manifest) =>
    manifest.permissions.map((permission) => ({ key: permission.key, moduleId: manifest.planEntitlement, access: permissionAccess(permission) })),
  );
}

export const BUILT_IN_MEMBER_ROLES = [
  { slug: "user", name: "User", description: "Read-only: can look at every app the organization has, but not change anything." },
  { slug: "editor", name: "Editor", description: "Everything a User has, plus writing and editing website posts, pages, media, categories and tags." },
] as const;

export type BuiltInMemberRoleSlug = (typeof BUILT_IN_MEMBER_ROLES)[number]["slug"];

/** The slug of the role new members get unless someone picks another one. */
export const DEFAULT_MEMBER_ROLE_SLUG: BuiltInMemberRoleSlug = "user";

/** Extra permissions the Editor role adds on top of User. Not publishing, site settings, members or products. */
export const EDITOR_EXTRA_PERMISSIONS: readonly string[] = ["websites.write", "websites.publish", "miniblog.write", "miniblog.publish"];

export function builtInRolePermissions(slug: BuiltInMemberRoleSlug, manifests: readonly ModuleManifest[]): string[] {
  const all = classifyPermissions(manifests);
  const read = all.filter((permission) => permission.access === "read").map((permission) => permission.key);
  if (slug === "user") return read.sort();
  const known = new Set(all.map((permission) => permission.key));
  return [...new Set([...read, ...EDITOR_EXTRA_PERMISSIONS.filter((key) => known.has(key))])].sort();
}

/** Pick the default role for a new member from an org's roles: User, else the first role that is not owner/admin. */
export function defaultMemberRoleId(roles: readonly { id: string; slug: string }[]): string | null {
  return (
    roles.find((role) => role.slug === DEFAULT_MEMBER_ROLE_SLUG)?.id ??
    roles.find((role) => role.slug !== "owner" && role.slug !== "admin")?.id ??
    roles[0]?.id ??
    null
  );
}

// Per-member app access ------------------------------------------------------

export type MemberAppLevel = "NONE" | "VIEW" | "EDIT";
export type MemberAppChoice = "ROLE" | MemberAppLevel;

export function parseMemberAppChoice(value: string): MemberAppChoice | null {
  return value === "ROLE" || value === "NONE" || value === "VIEW" || value === "EDIT" ? value : null;
}

export const MEMBER_OVERRIDE_ROLE_ID = "member-app-access";

/** Apps a member's access can be set for: modules with read or write permissions (not the admin-only Settings shell). */
export function adjustableModule(moduleId: string, classified: readonly ClassifiedPermission[]): boolean {
  return classified.some((permission) => permission.moduleId === moduleId && permission.access !== "admin");
}

/**
 * Turns a member's per-app levels into grants and exclusions, so `can()` stays the only check.
 *   NONE → exclude every permission of the app (including admin-level ones for that app)
 *   VIEW → allow its read permissions, exclude its write permissions
 *   EDIT → allow its read and write permissions (never admin-level ones)
 * Exclusions beat any role grant, so lowering always works; allows never reach
 * past the org's entitlement because `can()` checks that first.
 */
export function memberAppAccessRules(input: {
  userId: string;
  levels: Readonly<Record<string, MemberAppLevel>>;
  classified: readonly ClassifiedPermission[];
}): { grants: AccessGrant[]; exclusions: AccessExclusion[] } {
  const grants: AccessGrant[] = [];
  const exclusions: AccessExclusion[] = [];
  for (const [moduleId, level] of Object.entries(input.levels)) {
    const perms = input.classified.filter((permission) => permission.moduleId === moduleId);
    for (const permission of perms) {
      const allow =
        (level === "VIEW" && permission.access === "read") ||
        (level === "EDIT" && (permission.access === "read" || permission.access === "write"));
      const block = level === "NONE" || (level === "VIEW" && permission.access === "write");
      if (allow) grants.push({ permission: permission.key, effect: "allow", brandId: null, workspaceId: null, roleId: MEMBER_OVERRIDE_ROLE_ID });
      if (block) exclusions.push({ permission: permission.key, userId: input.userId, roleId: null, brandId: null, workspaceId: null });
    }
  }
  return { grants, exclusions };
}

/** What a set of permissions amounts to for one app, for showing "effective access". */
export function effectiveAppLevel(moduleId: string, has: (permission: string) => boolean, classified: readonly ClassifiedPermission[]): MemberAppLevel {
  const perms = classified.filter((permission) => permission.moduleId === moduleId && permission.access !== "admin");
  if (perms.some((permission) => permission.access === "write" && has(permission.key))) return "EDIT";
  if (perms.some((permission) => has(permission.key))) return "VIEW";
  return "NONE";
}

/** Guards for changing someone's app access. Returns an error message, or null when allowed. */
export function memberAccessChangeBlocked(input: { actorUserId: string; targetUserId: string; moduleEntitled: boolean; moduleAdjustable: boolean }): string | null {
  if (input.actorUserId === input.targetUserId) return "You cannot change your own app access.";
  if (!input.moduleAdjustable) return "That app's access is set by role only.";
  if (!input.moduleEntitled) return "This organization does not have that app.";
  return null;
}
