import { brandProfile } from "@pubcommand/core";
import { organizationsWithModule, rawPrisma, tenantDb } from "@pubcommand/db";

export type JobBrand = { organizationId: string; orgSlug: string; brandId: string; brandName: string };

/**
 * Brands a Track Record job should work on: organizations that are not suspended and have Track Record in their
 * plan (and not turned off), finance brands only. Org ids come from rawPrisma; everything else goes through tenantDb.
 * `brandIds` narrows it to brands that have rows the job needs (e.g. portfolios).
 */
export async function trackJobBrands(brandIdsByOrg: ReadonlyMap<string, readonly string[]>): Promise<JobBrand[]> {
  if (!brandIdsByOrg.size) return [];
  const entitled = await organizationsWithModule([...brandIdsByOrg.keys()], "performance");
  const orgs = await rawPrisma().organization.findMany({
    where: { id: { in: [...entitled] }, suspendedAt: null, deletedAt: null },
    select: { id: true, slug: true },
  });
  const out: JobBrand[] = [];
  for (const org of orgs) {
    const brands = await tenantDb(org.id).brand.findMany({ where: { id: { in: [...(brandIdsByOrg.get(org.id) ?? [])] } } });
    for (const brand of brands) {
      if (brandProfile(brand).niche !== "finance") continue;
      out.push({ organizationId: org.id, orgSlug: org.slug, brandId: brand.id, brandName: brand.name });
    }
  }
  return out;
}

/** Group (organizationId, brandId) rows into a map. */
export function byOrg(rows: readonly { organizationId: string; brandId: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.organizationId) ?? [];
    if (!list.includes(row.brandId)) list.push(row.brandId);
    map.set(row.organizationId, list);
  }
  return map;
}
