import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const KNOWLEDGE_READ = "knowledge.read";
export const KNOWLEDGE_WRITE = "knowledge.write";
/** Mark a note Shared so the organization's other brands can see it. Needs knowledge.write too. */
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
