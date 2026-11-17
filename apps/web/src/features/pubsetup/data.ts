import { tenantDb } from "@pubcommand/db";
import { BRANDING_KEYS, platformDefaults, resolveBranding, type BrandingKey } from "../../../../../modules/pubsetup/branding";

const OWN_SELECT = Object.fromEntries(BRANDING_KEYS.map((key) => [key, true])) as Record<BrandingKey, true>;

/** What a publication set itself (null = inherits), for the branding form. */
export async function publicationBrandingOwn(organizationId: string, brandId: string, publicationId: string) {
  const row = await tenantDb(organizationId).calendarPublication.findFirst({
    where: { id: publicationId, brandId },
    select: { ...OWN_SELECT, id: true, name: true, code: true, logoMime: true, emailHeaderMime: true, updatedAt: true },
  });
  return row;
}

/** Brand defaults as stored (null = platform default), plus image flags. */
export async function brandDefaultsOwn(organizationId: string, brandId: string) {
  return tenantDb(organizationId).pubBrandBranding.findFirst({
    where: { brandId },
    select: { ...OWN_SELECT, logoMime: true, emailHeaderMime: true, updatedAt: true },
  });
}

/** For each field: the value a blank field falls back to, and where it comes from. */
export function inheritedFor(level: "publication" | "brand", brandName: string, defaults: Partial<Record<BrandingKey, string | null>> | null) {
  const platform = platformDefaults(brandName);
  const resolved = resolveBranding(null, level === "publication" ? defaults : null, brandName);
  return Object.fromEntries(
    BRANDING_KEYS.map((key) => [
      key,
      level === "publication" && resolved.sources[key] === "brand" ? { value: resolved.values[key], from: "brand default" } : { value: platform[key], from: "platform default" },
    ]),
  ) as Record<BrandingKey, { value: string; from: string }>;
}
