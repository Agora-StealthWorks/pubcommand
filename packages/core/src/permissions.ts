export type PermissionEffect = "allow" | "deny";

export type AccessGrant = {
  permission: string;
  effect: PermissionEffect;
  brandId: string | null;
  workspaceId: string | null;
  roleId: string;
};

export type AccessExclusion = {
  permission: string;
  userId: string | null;
  roleId: string | null;
  brandId: string | null;
  workspaceId: string | null;
};

/** Resolved org access. Platform staff is not an input and does not bypass this check. */
export type AccessSubject = {
  userId: string;
  organizationId: string;
  roleId: string;
  membershipBrandId: string | null;
  membershipWorkspaceId: string | null;
  grants: readonly AccessGrant[];
  exclusions: readonly AccessExclusion[];
  entitledModuleIds: readonly string[];
  permissionModules: Readonly<Record<string, string>>;
};

export type AccessScope = {
  organizationId: string;
  brandId?: string | null;
  workspaceId?: string | null;
};

function covers(
  scopeBrand: string | null,
  scopeWorkspace: string | null,
  requested: AccessScope,
): boolean {
  if (scopeWorkspace) return requested.workspaceId === scopeWorkspace;
  if (scopeBrand) {
    if (!requested.brandId) return false;
    return requested.brandId === scopeBrand;
  }
  return true;
}

function membershipAllows(subject: AccessSubject, scope: AccessScope): boolean {
  if (scope.organizationId !== subject.organizationId) return false;
  if (subject.membershipWorkspaceId) {
    return scope.workspaceId === subject.membershipWorkspaceId;
  }
  if (subject.membershipBrandId) {
    if (!scope.brandId) return false;
    return scope.brandId === subject.membershipBrandId;
  }
  return true;
}

function exclusionMatches(subject: AccessSubject, exclusion: AccessExclusion, scope: AccessScope): boolean {
  if (exclusion.userId && exclusion.userId !== subject.userId) return false;
  if (exclusion.roleId && exclusion.roleId !== subject.roleId) return false;
  return covers(exclusion.brandId, exclusion.workspaceId, scope);
}

/**
 * A check passes only when the role allows the permission, the org plan entitles
 * the module, and no exclusion (or deny grant) blocks the scope.
 */
export function can(subject: AccessSubject, permission: string, scope: AccessScope): boolean {
  if (!membershipAllows(subject, scope)) return false;
  const moduleId = subject.permissionModules[permission];
  if (!moduleId) return false;
  if (!subject.entitledModuleIds.includes(moduleId)) return false;
  if (subject.exclusions.some((exclusion) => exclusion.permission === permission && exclusionMatches(subject, exclusion, scope))) {
    return false;
  }
  const relevant = subject.grants.filter(
    (grant) => grant.permission === permission && covers(grant.brandId, grant.workspaceId, scope),
  );
  if (relevant.some((grant) => grant.effect === "deny")) return false;
  return relevant.some((grant) => grant.effect === "allow");
}
