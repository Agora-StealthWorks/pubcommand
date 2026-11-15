import type { AccessSubject } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";

export const VIEWPORT_ORG_ID = "11111111-1111-4111-8111-111111111111";

export function viewportSubject(): AccessSubject {
  const permissionModules = moduleRegistry.permissionModules();
  return {
    userId: "viewport-user",
    organizationId: VIEWPORT_ORG_ID,
    roleId: "viewport-role",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants: Object.keys(permissionModules).map((permission) => ({
      permission,
      effect: "allow" as const,
      brandId: null,
      workspaceId: null,
      roleId: "viewport-role",
    })),
    exclusions: [],
    entitledModuleIds: moduleRegistry.all().map((manifest) => manifest.planEntitlement),
    permissionModules,
  };
}
