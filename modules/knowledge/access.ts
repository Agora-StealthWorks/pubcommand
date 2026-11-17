import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const KNOWLEDGE_READ = "knowledge.read";
export const KNOWLEDGE_WRITE = "knowledge.write";
/** Mark a note Shared so every brand's mini-brain can see it. Needs knowledge.write too. */
export const KNOWLEDGE_SHARE = "knowledge.share";

export function canReadKnowledge(subject: AccessSubject, scope: AccessScope): boolean {
  return can(subject, KNOWLEDGE_READ, scope);
}

export function canWriteKnowledge(subject: AccessSubject, scope: AccessScope): boolean {
  return can(subject, KNOWLEDGE_WRITE, scope);
}

export function canShareKnowledge(subject: AccessSubject, scope: AccessScope): boolean {
  return can(subject, KNOWLEDGE_WRITE, scope) && can(subject, KNOWLEDGE_SHARE, scope);
}

/**
 * The main Brain shows every brand's notes, so only members who are not tied
 * to one brand (or one workspace) may open it.
 */
export function canUseMainBrain(subject: Pick<AccessSubject, "membershipBrandId" | "membershipWorkspaceId">): boolean {
  return subject.membershipBrandId == null && subject.membershipWorkspaceId == null;
}
