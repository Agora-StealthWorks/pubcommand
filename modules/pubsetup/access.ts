import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const PUBSETUP_MODULE = "pubsetup";
export const PUBSETUP_MANAGE = "pubsetup.manage";

/**
 * Publication Setup is admin-only: the org plan must include it and the role must
 * hold pubsetup.manage (owner and admin by default). There is no read-only tier;
 * other apps read publications through features/pubsetup/read.ts under their own permissions.
 */
export function canManagePublications(subject: AccessSubject, scope: AccessScope): boolean {
  return subject.entitledModuleIds.includes(PUBSETUP_MODULE) && can(subject, PUBSETUP_MANAGE, scope);
}
