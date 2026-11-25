import { syncBrandLook, tenantDb } from "@pubcommand/db";

/**
 * Every brand has a form theme in its brand look (Settings → Brands): header and button colors,
 * logo and logo size, kept in step with the branding (followBrand). It becomes the default for
 * new forms when the brand has no default theme yet. Returns its id.
 */
export async function ensureBrandTheme(organizationId: string, brand: { id: string; name: string }): Promise<string> {
  const db = tenantDb(organizationId);
  const existing = await db.formTheme.findFirst({ where: { brandId: brand.id, followBrand: true, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (existing) return existing.id;
  const hasDefault = (await db.formTheme.count({ where: { brandId: brand.id, deletedAt: null, isDefault: true } })) > 0;
  const theme = await db.formTheme.create({
    data: {
      organizationId,
      brandId: brand.id,
      name: `${brand.name} brand look`.slice(0, 120),
      companyName: brand.name.slice(0, 200),
      privacyPolicyUrl: "",
      followBrand: true,
      isDefault: !hasDefault,
    },
    select: { id: true },
  });
  await syncBrandLook(organizationId, brand.id, { themeIds: [theme.id] });
  return theme.id;
}
