import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const SUPPORT_MODULE = "support";
export const SUPPORT_READ = "support.read";
export const SUPPORT_WRITE = "support.write";
export const SUPPORT_PUBLISH = "support.publish";
export type SupportPermission = typeof SUPPORT_READ | typeof SUPPORT_WRITE | typeof SUPPORT_PUBLISH;

/**
 * read: see records, gaps, agents. write: draft records, import, record gaps.
 * publish: publish records, confirm prices, approve Brain copies, manage agent keys and the
 * ElevenLabs connection (anything that changes what a customer can hear).
 */
export function canSupport(subject: AccessSubject, scope: AccessScope, permission: SupportPermission): boolean {
  return subject.entitledModuleIds.includes(SUPPORT_MODULE) && can(subject, permission, scope);
}
