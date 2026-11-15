import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const KNOWLEDGE_READ = "knowledge.read";
export const KNOWLEDGE_WRITE = "knowledge.write";

export function canReadKnowledge(subject: AccessSubject, scope: AccessScope): boolean {
  return can(subject, KNOWLEDGE_READ, scope);
}

export function canWriteKnowledge(subject: AccessSubject, scope: AccessScope): boolean {
  return can(subject, KNOWLEDGE_WRITE, scope);
}
