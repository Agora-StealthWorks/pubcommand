import { classifyPermissions, roleAppLevelOptions, type ClassifiedPermission, type PermissionAccess, type RoleAppLevel } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { appCatalog } from "./apps";

export type RoleAccessPermission = { key: string; description: string; access: PermissionAccess; group: string | null };

export type RoleAccessSection = {
  /** The app's module id, or "admin" for the Settings / admin-only permissions. */
  id: string;
  name: string;
  icon: string;
  /** Per-app levels (No access / View / Edit / Manage). Empty for the Admin section, which is set permission by permission. */
  levels: RoleAppLevel[];
  permissions: RoleAccessPermission[];
};

/** Admin-only modules shown together at the end, in this order (anything else not in the app catalog follows). */
const ADMIN_ORDER = ["settings", "pubsetup", "billing"];
const ADMIN_NAMES: Record<string, string> = { settings: "Settings", pubsetup: "Publication Setup", billing: "Plan" };

/**
 * Roles & access sections in sidebar order: one per app the organization has,
 * then "Admin". Apps the organization does not have come back in `notIncluded`.
 */
export function roleAccessSections(entitledModuleIds: readonly string[]): {
  included: RoleAccessSection[];
  notIncluded: { id: string; name: string; icon: string }[];
} {
  const manifests = moduleRegistry.all();
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const classified: ClassifiedPermission[] = classifyPermissions(manifests);
  const accessOf = new Map(classified.map((permission) => [permission.key, permission.access]));
  const toRows = (moduleId: string, group: string | null): RoleAccessPermission[] =>
    (byId.get(moduleId)?.permissions ?? []).map((permission) => ({
      key: permission.key,
      description: permission.description,
      access: accessOf.get(permission.key) ?? "write",
      group,
    }));

  const included: RoleAccessSection[] = [];
  const notIncluded: { id: string; name: string; icon: string }[] = [];
  const catalogIds = new Set<string>();
  for (const card of appCatalog()) {
    catalogIds.add(card.moduleId);
    const manifest = byId.get(card.moduleId);
    if (!manifest || manifest.permissions.length === 0) continue;
    if (!entitledModuleIds.includes(manifest.planEntitlement)) {
      notIncluded.push({ id: card.moduleId, name: card.name, icon: card.icon });
      continue;
    }
    included.push({
      id: card.moduleId,
      name: card.name,
      icon: card.icon,
      levels: roleAppLevelOptions(manifest.planEntitlement, classified),
      permissions: toRows(card.moduleId, null),
    });
  }

  const adminModules = manifests
    .filter((manifest) => !catalogIds.has(manifest.id) && manifest.permissions.length > 0 && entitledModuleIds.includes(manifest.planEntitlement))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  const adminRows = adminModules.flatMap((manifest) => toRows(manifest.id, ADMIN_NAMES[manifest.id] ?? manifest.name));
  if (adminRows.length > 0) included.push({ id: "admin", name: "Admin", icon: "⚙️", levels: [], permissions: adminRows });
  return { included, notIncluded };
}

function rank(moduleId: string): number {
  const index = ADMIN_ORDER.indexOf(moduleId);
  return index === -1 ? ADMIN_ORDER.length : index;
}
