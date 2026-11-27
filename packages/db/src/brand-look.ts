import { rawPrisma } from "./client";
import { tenantDb } from "./tenant";

/**
 * "Use brand look": form themes and Mini-Blogs with followBrand on take the brand's branding
 * (Settings → Brands → Brand defaults): header color, accent color, the logo made for that
 * header, and the logo size. Their renderers keep reading their own columns; this copies the
 * look into them. Idempotent: nothing is written when a theme or Mini-Blog already matches,
 * and a logo is stored again only when its bytes changed.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO_HEIGHTS: Record<string, number> = { Small: 28, Medium: 40, Large: 56, "Extra large": 72 };
const MAX_THEME_LOGO = 2 * 1024 * 1024;
const MAX_SITE_LOGO = 3 * 1024 * 1024;

function darkBackground(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.4;
}

type Logo = { filename: string; mime: string; data: Uint8Array<ArrayBuffer> };

export type BrandLookValues = { headerColor: string | null; accentColor: string | null; logoHeight: number; logoFor: (headerColor: string) => Logo | null };

/** The brand's look as stored (null colors = the brand never set them). */
export async function loadBrandLook(organizationId: string, brandId: string): Promise<BrandLookValues> {
  const row = await tenantDb(organizationId).pubBrandBranding.findFirst({
    where: { brandId },
    select: { primaryColor: true, accentColor: true, logoSize: true, logoFilename: true, logoMime: true, logoData: true, logoOnDarkFilename: true, logoOnDarkMime: true, logoOnDarkData: true },
  });
  const onLight: Logo | null = row?.logoData && row.logoMime ? { filename: row.logoFilename ?? "logo", mime: row.logoMime, data: new Uint8Array(row.logoData) } : null;
  const onDark: Logo | null = row?.logoOnDarkData && row.logoOnDarkMime ? { filename: row.logoOnDarkFilename ?? "logo", mime: row.logoOnDarkMime, data: new Uint8Array(row.logoOnDarkData) } : null;
  return {
    headerColor: row?.primaryColor && HEX.test(row.primaryColor) ? row.primaryColor.toLowerCase() : null,
    accentColor: row?.accentColor && HEX.test(row.accentColor) ? row.accentColor.toLowerCase() : null,
    logoHeight: LOGO_HEIGHTS[row?.logoSize ?? ""] ?? LOGO_HEIGHTS.Medium!,
    // The logo made for the header: light artwork on a dark header, else the other one.
    logoFor: (headerColor) => (darkBackground(headerColor) ? (onDark ?? onLight) : (onLight ?? onDark)),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Copy the brand's look into every following theme and Mini-Blog of the brand
 * (or only the ids given). Themes take colors, logo and logo size; Mini-Blogs
 * take colors and logo but keep their own logo size.
 */
export async function syncBrandLook(organizationId: string, brandId: string, only?: { themeIds?: string[]; siteIds?: string[] }): Promise<{ themes: number; sites: number }> {
  const db = tenantDb(organizationId);
  const look = await loadBrandLook(organizationId, brandId);
  let themesChanged = 0;
  let sitesChanged = 0;

  const themes = await db.formTheme.findMany({ where: { brandId, followBrand: true, deletedAt: null, ...(only?.themeIds ? { id: { in: only.themeIds } } : {}) } });
  for (const theme of themes) {
    const barColor = look.headerColor ?? "#0b1220";
    const accentColor = look.accentColor ?? "#1d4ed8";
    const logo = look.logoFor(barColor);
    const current = theme.logoFileId ? await db.formFile.findFirst({ where: { id: theme.logoFileId, kind: "logo" } }) : null;
    let logoFileId: string | null = theme.logoFileId;
    if (!logo || logo.data.length > MAX_THEME_LOGO) logoFileId = null;
    else if (!current || current.mimeType !== logo.mime || !sameBytes(new Uint8Array(current.data), logo.data)) {
      logoFileId = (
        await db.formFile.create({ data: { organizationId, kind: "logo", filename: logo.filename.slice(0, 200), mimeType: logo.mime, size: logo.data.length, data: logo.data }, select: { id: true } })
      ).id;
    }
    const changed = theme.barColor !== barColor || theme.accentColor !== accentColor || theme.logoHeight !== look.logoHeight || theme.logoFileId !== logoFileId || Boolean(theme.logoUrl);
    if (!changed) continue;
    await db.formTheme.updateMany({ where: { id: theme.id }, data: { barColor, accentColor, logoHeight: look.logoHeight, logoFileId, logoUrl: null } });
    if (theme.logoFileId && theme.logoFileId !== logoFileId) await db.formFile.deleteMany({ where: { id: theme.logoFileId, kind: "logo" } });
    themesChanged += 1;
  }

  const sites = await db.textSite.findMany({ where: { brandId, followBrand: true, deletedAt: null, ...(only?.siteIds ? { id: { in: only.siteIds } } : {}) } });
  for (const site of sites) {
    const headerBg = look.headerColor ?? "#111827";
    const accentColor = look.accentColor ?? "#1d4ed8";
    const logo = look.logoFor(headerBg);
    const current = site.logoAssetId ? await db.funnelAsset.findFirst({ where: { id: site.logoAssetId, ownerId: site.id } }) : null;
    let logoAssetId: string | null = site.logoAssetId;
    if (!logo || logo.data.length > MAX_SITE_LOGO) logoAssetId = null;
    else if (!current || current.mimeType !== logo.mime || !sameBytes(new Uint8Array(current.data), logo.data)) {
      logoAssetId = (
        await db.funnelAsset.create({ data: { organizationId, ownerId: site.id, kind: "logo", filename: logo.filename.slice(0, 200), mimeType: logo.mime, size: logo.data.length, data: logo.data }, select: { id: true } })
      ).id;
    }
    // The logo SIZE is the Mini-Blog's own (its Logo size slider); only a new Mini-Blog starts at the brand's.
    const changed = site.headerBg !== headerBg || site.accentColor !== accentColor || site.logoAssetId !== logoAssetId || Boolean(site.logoUrl);
    if (!changed) continue;
    await db.textSite.updateMany({ where: { id: site.id }, data: { headerBg, accentColor, logoAssetId, logoUrl: null } });
    if (site.logoAssetId && site.logoAssetId !== logoAssetId) await db.funnelAsset.deleteMany({ where: { id: site.logoAssetId, ownerId: site.id } });
    sitesChanged += 1;
  }
  return { themes: themesChanged, sites: sitesChanged };
}

/** Boot step: bring every following theme and Mini-Blog up to date with its brand. */
export async function syncAllBrandLooks(): Promise<{ brands: number; themes: number; sites: number }> {
  const brands = await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    const [themeBrands, siteBrands] = await Promise.all([
      tx.formTheme.findMany({ where: { followBrand: true, deletedAt: null }, select: { organizationId: true, brandId: true }, distinct: ["brandId"] }),
      tx.textSite.findMany({ where: { followBrand: true, deletedAt: null }, select: { organizationId: true, brandId: true }, distinct: ["brandId"] }),
    ]);
    return [...new Map([...themeBrands, ...siteBrands].map((row) => [row.brandId, row])).values()];
  });
  let themes = 0;
  let sites = 0;
  for (const brand of brands) {
    try {
      const result = await syncBrandLook(brand.organizationId, brand.brandId);
      themes += result.themes;
      sites += result.sites;
    } catch (error) {
      console.error("[brand-look] sync failed", brand.brandId, error);
    }
  }
  return { brands: brands.length, themes, sites };
}
