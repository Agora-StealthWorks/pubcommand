import { tenantDb } from "@pubcommand/db";
import { contrastText, isHttpUrl, safeColor } from "../../../../../modules/miniblog/site";
import { safeZone } from "../../../../../modules/miniblog/time";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof tenantDb>;
export type SiteRow = NonNullable<Awaited<ReturnType<Db["textSite"]["findFirst"]>>>;
export type PostRow = NonNullable<Awaited<ReturnType<Db["textPost"]["findFirst"]>>>;

export async function orgTimezone(organizationId: string): Promise<string> {
  const settings = await tenantDb(organizationId).orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  return safeZone(settings?.timezone);
}

export type Branding = {
  brandName: string;
  logoSrc: string | null;
  logoHeight: number;
  headerBg: string;
  headerText: string;
  accentColor: string;
  accentText: string;
  companyName: string;
  privacyUrl: string | null;
  termsUrl: string | null;
};

export function siteBranding(site: SiteRow, brandName: string, base: string): Branding {
  const headerBg = safeColor(site.headerBg, "#111827");
  const accentColor = safeColor(site.accentColor, "#1d4ed8");
  return {
    brandName,
    logoSrc: site.logoAssetId ? `${base}/logo?v=${site.updatedAt.getTime()}` : isHttpUrl(site.logoUrl) ? site.logoUrl : null,
    logoHeight: Math.max(16, Math.min(120, site.logoHeight)),
    headerBg,
    headerText: contrastText(headerBg),
    accentColor,
    accentText: contrastText(accentColor),
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
