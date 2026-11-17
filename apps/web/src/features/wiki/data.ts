import { tenantDb } from "@pubcommand/db";
import { getBranding, getEditor, getEditors, getPublication, getPublications, type Editor, type Publication } from "../pubsetup/read";
import { approvedCounts, approvedForEditor, approvedForPublication, latestApproved } from "../testimonials/read";
import { matchPublication } from "../../../../../modules/pubsetup/brain";

/**
 * The wiki's loaders. Publications, editors and branding come only from the
 * Publication Setup read API; testimonials only from Testimonials' approved read API.
 * Archived publications and editors are not shown.
 */

export async function wikiLists(organizationId: string, brandId: string) {
  const [publications, editors, counts] = await Promise.all([
    getPublications(organizationId, brandId),
    getEditors(organizationId, brandId),
    approvedCounts(organizationId, brandId),
  ]);
  return { publications, editors, counts };
}

export async function wikiHome(organizationId: string, brandId: string, options: { testimonials: boolean }) {
  const [lists, latest] = await Promise.all([
    wikiLists(organizationId, brandId),
    options.testimonials ? latestApproved(organizationId, brandId, 4) : Promise.resolve({ items: [], total: 0 }),
  ]);
  return { ...lists, latest };
}

/** Publication slugs by id, so an editor's publications can link to their wiki pages. */
function slugMap(publications: readonly Publication[]): Map<string, Publication> {
  return new Map(publications.map((p) => [p.id, p]));
}

export async function wikiPublication(organizationId: string, brandId: string, ref: string, options: { calendar: boolean; promos: boolean }) {
  const pub = await getPublication(organizationId, brandId, ref);
  if (!pub || pub.archived) return null;
  const db = tenantDb(organizationId);
  const today = new Date();
  const [branding, editors, testimonials, issues, promoRows, allPubs] = await Promise.all([
    getBranding(organizationId, pub.id),
    getEditors(organizationId, brandId),
    approvedForPublication(organizationId, brandId, pub.id, 6),
    options.calendar
      ? db.calendarIssue.findMany({
          where: { brandId, publicationCode: pub.code, deletedAt: null, mailDate: { lte: today } },
          orderBy: [{ mailDate: "desc" }],
          take: 6,
          select: { id: true, title: true, mailDate: true, status: true, issueType: true },
        })
      : Promise.resolve([]),
    options.promos
      ? db.promo.findMany({ where: { brandId, deletedAt: null, product: { not: null } }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, title: true, product: true, promoType: true, promoStatus: true } })
      : Promise.resolve([]),
    options.promos ? getPublications(organizationId, brandId) : Promise.resolve([]),
  ]);
  const byId = new Map(editors.map((e) => [e.id, e]));
  const team = pub.editors.map((ref) => ({ ...ref, editor: byId.get(ref.id) ?? null })).filter((x): x is typeof x & { editor: Editor } => Boolean(x.editor));
  const promos = promoRows.filter((p) => matchPublication(p.product, allPubs)?.id === pub.id).slice(0, 8);
  return { pub, branding, team, testimonials, issues, promos };
}

export async function wikiEditor(organizationId: string, brandId: string, ref: string) {
  const editor = await getEditor(organizationId, brandId, ref);
  if (!editor || editor.archived) return null;
  const [publications, testimonials] = await Promise.all([getPublications(organizationId, brandId), approvedForEditor(organizationId, brandId, editor, 6)]);
  const pubs = slugMap(publications);
  const writes = editor.publications.map((p) => ({ ...p, pub: pubs.get(p.id) ?? null })).filter((p): p is typeof p & { pub: Publication } => Boolean(p.pub));
  return { editor, writes, testimonials, pubs };
}
