import type { CalOption, OrgOption } from "./console-forms";
import { ispyDb } from "./db";

/** Reads used by several ISpy console pages. */

export async function loadOrgOptions(): Promise<OrgOption[]> {
  return ispyDb(async (tx) => {
    const [orgs, brands] = await Promise.all([
      tx.organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, niche: true, organizationId: true } }),
    ]);
    return orgs.map((o) => ({ id: o.id, name: o.name, brands: brands.filter((b) => b.organizationId === o.id).map((b) => ({ id: b.id, name: b.name, niche: b.niche })) }));
  });
}

export async function loadCalendarPublications(brandIds: string[]): Promise<CalOption[]> {
  if (!brandIds.length) return [];
  return ispyDb((tx) => tx.calendarPublication.findMany({ where: { brandId: { in: brandIds }, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, brandId: true } }));
}

export async function loadRegistry(feed: string) {
  return ispyDb(async (tx) => {
    const publishers = await tx.ispyPublisher.findMany({
      where: { deletedAt: null, feed },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, feed: true, parentId: true, domains: true, fromAddresses: true, website: true, notes: true, excludeBrands: true, linkedOrganizationId: true, linkedBrandId: true, hideFromOtherOrgs: true },
    });
    const ids = publishers.map((p) => p.id);
    const [publications, lists, inboxes, gurus, listCounts] = await Promise.all([
      tx.ispyPublication.findMany({ where: { deletedAt: null, publisherId: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, publisherId: true, name: true, aliases: true, notes: true, linkedBrandId: true, linkedOrganizationId: true, linkedCalendarPublicationId: true } }),
      tx.ispyList.findMany({ where: { deletedAt: null, publisherId: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, publisherId: true, publicationId: true, name: true, category: true, synonyms: true, isIgnored: true, editorialPubCode: true, dedicatedPubCode: true } }),
      tx.ispyInbox.findMany({ where: { OR: [{ publisherId: { in: ids } }, { list: { publisherId: { in: ids } } }] }, select: { id: true, address: true, level: true, status: true, provider: true, publisherId: true, publicationId: true, listId: true, affiliateSeed: true, lastMessageAt: true } }),
      tx.ispyGuruPublication.findMany({ where: { publication: { publisherId: { in: ids } } }, select: { publicationId: true, role: true, guru: { select: { id: true, name: true } } } }),
      tx.ispyEmail.groupBy({ by: ["listId"], where: { listId: { not: null }, receivedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: { _all: true } }),
    ]);
    const weekly = new Map(listCounts.map((c) => [c.listId!, c._count._all]));
    return { publishers, publications, lists: lists.map((l) => ({ ...l, perWeek: weekly.get(l.id) ?? 0 })), inboxes, gurus };
  });
}

export type Registry = Awaited<ReturnType<typeof loadRegistry>>;
