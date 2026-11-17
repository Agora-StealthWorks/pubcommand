import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const WIKI_MODULE = "wiki";

/** Read the wiki: plan entitles it and the role holds wiki.read (every role by default). */
export function canReadWiki(subject: AccessSubject, scope: AccessScope): boolean {
  return subject.entitledModuleIds.includes(WIKI_MODULE) && can(subject, "wiki.read", scope);
}

/** Another app's permission, for cross-links ("Edit in Publication Setup", "All testimonials"...). */
export function canUse(subject: AccessSubject, scope: AccessScope, moduleId: string, permission: string): boolean {
  return subject.entitledModuleIds.includes(moduleId) && can(subject, permission, scope);
}
