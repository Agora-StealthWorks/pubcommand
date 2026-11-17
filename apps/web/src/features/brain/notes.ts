import { slugifyName } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { linkResolver, linksTo, type LinkCandidate } from "../../../../../modules/knowledge/wikilinks";
import { scopeWhere, type BrainScope } from "../../../../../modules/knowledge/visibility";

/** Columns for lists (no body). */
export const NOTE_LIST_SELECT = {
  id: true,
  title: true,
  folder: true,
  brandId: true,
  visibility: true,
  source: true,
  updatedAt: true,
} as const;

/** One note, only if it is visible in this scope. */
export async function getVisibleNote(organizationId: string, scope: BrainScope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return tenantDb(organizationId).knowledgePage.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] } });
}

/** True when the note exists (not deleted) but only the main Brain may see it. */
export async function noteExists(organizationId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return (await tenantDb(organizationId).knowledgePage.count({ where: { id, deletedAt: null } })) > 0;
}

export async function recentNotes(organizationId: string, scope: BrainScope, take = 20) {
  return tenantDb(organizationId).knowledgePage.findMany({ where: scopeWhere(scope), select: NOTE_LIST_SELECT, orderBy: { updatedAt: "desc" }, take });
}

export async function notesInFolder(organizationId: string, scope: BrainScope, folder: string | null, take = 300) {
  return tenantDb(organizationId).knowledgePage.findMany({
    where: { AND: [scopeWhere(scope), { folder }] },
    select: NOTE_LIST_SELECT,
    orderBy: { title: "asc" },
    take,
  });
}

export async function sharedNotes(organizationId: string, scope: BrainScope, take = 100) {
  return tenantDb(organizationId).knowledgePage.findMany({
    where: { AND: [scopeWhere(scope), { visibility: "SHARED" }] },
    select: NOTE_LIST_SELECT,
    orderBy: { updatedAt: "desc" },
    take,
  });
}

/** Titles of every note visible in this scope, for [[link]] resolution. */
export async function linkIndex(organizationId: string, scope: BrainScope): Promise<LinkCandidate[]> {
  return tenantDb(organizationId).knowledgePage.findMany({
    where: scopeWhere(scope),
    select: { id: true, title: true, brandId: true, visibility: true },
  });
}

export async function noteResolver(organizationId: string, scope: BrainScope) {
  return linkResolver(await linkIndex(organizationId, scope), scope.kind === "brand" ? scope.brandId : null);
}

/** Visible notes that link to this one with [[Title]]. */
export async function backlinks(organizationId: string, scope: BrainScope, note: { id: string; title: string }) {
  const candidates = await tenantDb(organizationId).knowledgePage.findMany({
    where: { AND: [scopeWhere(scope), { id: { not: note.id } }, { body: { contains: note.title, mode: "insensitive" } }, { body: { contains: "[[" } }] },
    select: { ...NOTE_LIST_SELECT, body: true },
    take: 200,
  });
  return candidates.filter((row) => linksTo(row.body, note.title)).map(({ body: _body, ...row }) => row);
}

export async function uniqueSlug(organizationId: string, title: string): Promise<string> {
  const base = (slugifyName(title) || "note").slice(0, 60);
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.knowledgePage.count({ where: { slug } }); n += 1) slug = `${base}-${n}`;
  return slug;
}
