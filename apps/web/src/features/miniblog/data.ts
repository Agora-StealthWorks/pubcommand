import { tenantDb } from "@pubcommand/db";
import { isHttpUrl } from "../../../../../modules/miniblog/site";
import { safeZone } from "../../../../../modules/miniblog/time";
import { DEFAULT_MEDIUMS, cleanMediums } from "../../../../../modules/miniblog/mediums";
import { lookFrom, type Look } from "./article";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof tenantDb>;
export type SiteRow = NonNullable<Awaited<ReturnType<Db["textSite"]["findFirst"]>>>;
export type PostRow = NonNullable<Awaited<ReturnType<Db["textPost"]["findFirst"]>>>;

export async function orgTimezone(organizationId: string): Promise<string> {
  const settings = await tenantDb(organizationId).orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  return safeZone(settings?.timezone);
}

/** A Mini-Blog's look (see `Look` in ./article) plus what its public pages show around it. */
export type Branding = Look & {
  brandName: string;
  logoSrc: string | null;
  companyName: string;
  privacyUrl: string | null;
  termsUrl: string | null;
};

export function siteBranding(site: SiteRow, brandName: string, base: string): Branding {
  const look = lookFrom(site);
  return {
    brandName,
    logoSrc: site.logoAssetId ? `${base}/logo?v=${site.updatedAt.getTime()}` : isHttpUrl(site.logoUrl) ? site.logoUrl : null,
    logoHeight: look.logoHeight,
    headerBg: look.headerBg,
    headerText: look.headerText,
    accentColor: look.accentColor,
    accentText: look.accentText,
    buttonColor: look.buttonColor,
    buttonText: look.buttonText,
    pageBg: look.pageBg,
    pageMuted: look.pageMuted,
    pageLink: look.pageLink,
    theme: look.theme,
    titleColor: look.titleColor,
    companyName: (site.companyName || brandName).trim(),
    privacyUrl: isHttpUrl(site.privacyUrl) ? site.privacyUrl : null,
    termsUrl: isHttpUrl(site.termsUrl) ? site.termsUrl : null,
  };
}

export async function loadSiteForBrand(organizationId: string, brandId: string, siteId: string) {
  if (!UUID_RE.test(siteId)) return null;
  return tenantDb(organizationId).textSite.findFirst({ where: { id: siteId, brandId, deletedAt: null } });
}

export async function listSites(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const sites = await db.textSite.findMany({ where: { brandId, deletedAt: null }, orderBy: { updatedAt: "desc" } });
  return Promise.all(
    sites.map(async (site) => ({
      ...site,
      postCount: await db.textPost.count({ where: { siteId: site.id, deletedAt: null } }),
      optinCount: await db.textOptin.count({ where: { siteId: site.id } }),
    })),
  );
}

const STATUS_TONE = { draft: "neutral", published: "ok", live: "ok", scheduled: "accent" } as const;
const STATUS_LABEL = { draft: "Draft", published: "Published", live: "Live", scheduled: "Scheduled" } as const;
export function statusBadge(status: string): { tone: (typeof STATUS_TONE)[keyof typeof STATUS_TONE] | "neutral"; label: string } {
  const key = status as keyof typeof STATUS_TONE;
  return { tone: STATUS_TONE[key] ?? "neutral", label: STATUS_LABEL[key] ?? status };
}

/** The organization's mediums (Mini-Blog → App settings); Email, SMS, Push Notification until an admin saves a list. */
export async function loadMediums(organizationId: string): Promise<string[]> {
  const row = await tenantDb(organizationId).miniblogSettings.findUnique({ where: { organizationId }, select: { mediums: true } });
  return row ? cleanMediums(row.mediums) : [...DEFAULT_MEDIUMS];
}
