import { can } from "@pubcommand/core";
import { organizationHasModule, resolveOrgBySlug, tenantDb, type Prisma } from "@pubcommand/db";
import { cache } from "react";
import { createHash } from "node:crypto";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { resolveCustomHost } from "@/features/domains/resolve";
import { getCategories, getEditors, getPublications, type Editor, type Publication, type PublicationCategory } from "@/features/pubsetup/read";
import { menuFrom, publicBaseFor, sitePath, themeFrom, viewerFor, type MenuItem, type SiteTheme, type Viewer } from "../../../../../modules/websites/content";
import { isFreePublication, orgTimezone, type SiteRow } from "./data";
import { sortByCategory } from "../../../../../modules/pubsetup/categories";
import { readMember, type SignedInMember } from "./members";

/** Is this request for the org the URL names? (Custom-domain requests resolve to their org.) */
export async function publicSiteMatches(orgSlug: string): Promise<boolean> {
  const request = await currentRequest();
  return request.site.kind === "org" && request.site.slug === orgSlug;
}

async function moduleEnabled(organizationId: string): Promise<boolean> {
  // Plan, staff override, org switch, suspended/deleted: decided in one place.
  return organizationHasModule(organizationId, "websites");
}

/** Signed-in PubCommand staff with websites.read may preview drafts and unpublished sites. */
async function isStaffPreviewer(orgSlug: string): Promise<boolean> {
  try {
    const ctx = await getOrgContext(orgSlug);
    return ctx.kind === "ok" && ctx.subject.entitledModuleIds.includes("websites") && can(ctx.subject, "websites.read", ctx.scope);
  } catch {
    return false;
  }
}

export type LoadedSite = {
  organizationId: string;
  orgSlug: string;
  site: SiteRow;
  brandName: string;
  theme: SiteTheme;
  menu: MenuItem[];
  topics: MenuItem[];
  timeZone: string;
  /** Link prefix: "/w/<site>" on the org host, "" on the site's own domain. */
  base: string;
  /** Staff preview (drafts visible, nothing recorded). */
  staff: boolean;
  now: Date;
  /** In website order: category order, then the publication's order, then name. */
  publications: Publication[];
  /** The brand's publication categories (Publication Setup), in order. */
  categories: PublicationCategory[];
  free: Publication[];
  paid: Publication[];
  editors: Editor[];
  /** Brand logos in Publication Setup (fallback when the site has none of its own). */
  brandLogo: { dark: boolean; light: boolean };
};

/** Everything a public page needs about the site. Cached per request. */
export const loadSite = cache(async (orgSlug: string, siteSlug: string): Promise<LoadedSite | null> => {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(siteSlug)) return null;
  if (!(await publicSiteMatches(orgSlug))) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await moduleEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const site = await db.webSite.findFirst({ where: { slug: siteSlug, deletedAt: null } });
  if (!site) return null;
  const staff = await isStaffPreviewer(orgSlug);
  if (site.status !== "live" && !staff) return null;
  const [brand, branding, timeZone, unsorted, editors, request, categories] = await Promise.all([
    db.brand.findFirst({ where: { id: site.brandId }, select: { name: true } }),
    db.pubBrandBranding.findFirst({ where: { brandId: site.brandId }, select: { logoMime: true, logoOnDarkMime: true } }),
    orgTimezone(org.id),
    getPublications(org.id, site.brandId, { activeOnly: true }),
    getEditors(org.id, site.brandId, { activeOnly: true }),
    currentRequest(),
    getCategories(org.id, site.brandId),
  ]);
  const publications = sortByCategory(unsorted, categories);
  return {
    organizationId: org.id,
    orgSlug,
    site,
    brandName: brand?.name ?? site.name,
    theme: themeFrom(site.theme),
    menu: menuFrom(site.menu),
    topics: menuFrom(site.topics),
    timeZone,
    base: await linkBase(request.customDomain, site.slug),
    staff,
    now: new Date(),
    publications,
    categories,
    free: publications.filter(isFreePublication),
    paid: publications.filter((pub) => !isFreePublication(pub)),
    editors,
    brandLogo: { dark: Boolean(branding?.logoOnDarkMime), light: Boolean(branding?.logoMime) },
  };
});

/**
 * Link prefix for the site's pages. On the org host it is "/w/<site>". On a custom
 * domain whose root is the site it is "" (clean URLs); on any other custom domain
 * (e.g. a members-only subdomain pointing at /w/<site>/my) absolute "/w/<site>/…"
 * paths are used, which custom domains serve as-is.
 */
async function linkBase(customDomain: string | null, siteSlug: string): Promise<string> {
  const own = sitePath(siteSlug);
  if (!customDomain) return own;
  const resolved = await resolveCustomHost(customDomain);
  return resolved?.targetPath === own ? "" : own;
}

/**
 * The signed-in reader (if any), cached per request. `member` is set only for a member with a
 * password; one who opened a set-password link but has not set it yet is `pending` and counts
 * as signed out everywhere except the set-password page (see viewerFor / membersGate).
 */
export const loadViewer = cache(async (organizationId: string, siteId: string): Promise<{ member: SignedInMember | null; pending: SignedInMember | null; viewer: Viewer }> => {
  const found = await readMember(organizationId, siteId);
  const member = found?.hasPassword ? found : null;
  return { member, pending: found && !found.hasPassword ? found : null, viewer: viewerFor(found) };
});

/** Live posts (or everything for staff previews). */
export function liveWhere(loaded: LoadedSite, extra: Prisma.WebPostWhereInput = {}): Prisma.WebPostWhereInput {
  return {
    siteId: loaded.site.id,
    deletedAt: null,
    status: { in: ["published", "scheduled"] },
    publishedAt: { lte: loaded.now },
    ...extra,
  };
}

export const CARD_SELECT = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  featuredAssetId: true,
  publishedAt: true,
  publicationId: true,
  contentType: true,
  access: true,
  authorName: true,
  authorEditorId: true,
  terms: { select: { term: { select: { name: true, slug: true, kind: true } } } },
} satisfies Prisma.WebPostSelect;

export type CardPost = Prisma.WebPostGetPayload<{ select: typeof CARD_SELECT }>;

export async function livePosts(loaded: LoadedSite, where: Prisma.WebPostWhereInput, take: number, skip = 0): Promise<CardPost[]> {
  return tenantDb(loaded.organizationId).webPost.findMany({
    where: liveWhere(loaded, { kind: "post", ...where }),
    orderBy: { publishedAt: "desc" },
    take,
    skip,
    select: CARD_SELECT,
  });
}

export function pubFor(loaded: LoadedSite, id: string | null | undefined): Publication | undefined {
  return id ? loaded.publications.find((pub) => pub.id === id) : undefined;
}

export function pubBySlug(loaded: LoadedSite, slug: string): Publication | undefined {
  return loaded.publications.find((pub) => pub.slug === slug || pub.code.toLowerCase() === slug.toLowerCase());
}

export function hashIp(ip: string | null): string | null {
  const salt = process.env.AUTH_SECRET;
  if (!ip || !salt) return null;
  return createHash("sha256").update(`websites:${salt}:${ip}`).digest("hex").slice(0, 40);
}

export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}

/** Where a public form came from, so we can send the reader back ("/w/x/post" or "/post"). */
export function publicBaseFromPath(pathname: string, siteSlug: string): string {
  return publicBaseFor(pathname, siteSlug);
}
