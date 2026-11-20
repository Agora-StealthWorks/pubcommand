import { tenantDb, type Prisma } from "@pubcommand/db";
import { funnelGroup } from "../../../../../modules/pubsetup/groups";
import { safeZone } from "../../../../../modules/miniblog/time";
import { getEditors, getPublications, type Publication } from "@/features/pubsetup/read";

type Db = ReturnType<typeof tenantDb>;
export type SiteRow = NonNullable<Awaited<ReturnType<Db["webSite"]["findFirst"]>>>;
export type PostRow = NonNullable<Awaited<ReturnType<Db["webPost"]["findFirst"]>>>;

export async function orgTimezone(organizationId: string): Promise<string> {
  const settings = await tenantDb(organizationId).orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  return safeZone(settings?.timezone);
}

export function isFreePublication(pub: Pick<Publication, "pubType" | "tier">): boolean {
  return funnelGroup(pub) === "free";
}

/** Publications of the brand from Publication Setup, split free / paid, for pickers. */
export async function sitePublications(organizationId: string, brandId: string) {
  const pubs = await getPublications(organizationId, brandId, { activeOnly: true });
  return { all: pubs, free: pubs.filter(isFreePublication), paid: pubs.filter((pub) => !isFreePublication(pub)) };
}

export async function siteEditors(organizationId: string, brandId: string) {
  return getEditors(organizationId, brandId, { activeOnly: true });
}

export type PostFilters = { kind: "post" | "page"; status?: string; publicationId?: string; access?: string; contentType?: string; termId?: string; q?: string; trash?: boolean };

export function postWhere(siteId: string, filters: PostFilters, now: Date): Prisma.WebPostWhereInput {
  const where: Prisma.WebPostWhereInput = { siteId, kind: filters.kind, deletedAt: filters.trash ? { not: null } : null };
  if (filters.status === "published") Object.assign(where, { OR: [{ status: "published", publishedAt: { lte: now } }, { status: "scheduled", publishedAt: { lte: now } }] });
  else if (filters.status === "scheduled") Object.assign(where, { status: { in: ["scheduled", "published"] }, publishedAt: { gt: now } });
  else if (filters.status === "draft" || filters.status === "pending") where.status = filters.status;
  if (filters.publicationId) where.publicationId = filters.publicationId === "none" ? null : filters.publicationId;
  if (filters.access) where.access = filters.access;
  if (filters.contentType) where.contentType = filters.contentType;
  if (filters.termId) where.terms = { some: { termId: filters.termId } };
  if (filters.q) where.title = { contains: filters.q, mode: "insensitive" };
  return where;
}

export async function statusCounts(organizationId: string, siteId: string, kind: "post" | "page", now: Date) {
  const db = tenantDb(organizationId);
  const [all, published, scheduled, draft, pending, trash] = await Promise.all([
    db.webPost.count({ where: postWhere(siteId, { kind }, now) }),
    db.webPost.count({ where: postWhere(siteId, { kind, status: "published" }, now) }),
    db.webPost.count({ where: postWhere(siteId, { kind, status: "scheduled" }, now) }),
    db.webPost.count({ where: postWhere(siteId, { kind, status: "draft" }, now) }),
    db.webPost.count({ where: postWhere(siteId, { kind, status: "pending" }, now) }),
    db.webPost.count({ where: postWhere(siteId, { kind, trash: true }, now) }),
  ]);
  return { all, published, scheduled, draft, pending, trash };
}

export async function siteTerms(organizationId: string, siteId: string) {
  const terms = await tenantDb(organizationId).webTerm.findMany({ where: { siteId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return { categories: terms.filter((term) => term.kind === "category"), tags: terms.filter((term) => term.kind === "tag") };
}

/** Media for pickers (no bytes). */
export async function siteMedia(organizationId: string, siteId: string, take = 200) {
  return tenantDb(organizationId).webAsset.findMany({
    where: { siteId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, filename: true, mimeType: true, size: true, alt: true, createdAt: true },
  });
}

export function assetPath(siteSlug: string, assetId: string): string {
  return `/w/${siteSlug}/media/${assetId}`;
}
