import { tenantDb } from "@pubcommand/db";
import { contrastText } from "../../../../../modules/pubsetup/branding";

export type BrandLook = {
  /** Header / bar color (#rrggbb). */
  headerColor: string;
  /** Buttons and links (#rrggbb). */
  accentColor: string;
  companyName: string;
  /** The logo made for the header color (light artwork on a dark header), else the other one. */
  logo: { filename: string; mime: string; data: Uint8Array<ArrayBuffer> } | null;
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A brand's look from Settings → Brands → Brand defaults, for apps that start a new branded
 * thing (a form theme, a Mini-Blog). Fields the brand never set fall back to the given defaults.
 */
export async function brandLook(organizationId: string, brand: { id: string; name: string }, defaults: { headerColor: string; accentColor: string }): Promise<BrandLook> {
  const row = await tenantDb(organizationId).pubBrandBranding.findFirst({
    where: { brandId: brand.id },
    select: { primaryColor: true, accentColor: true, logoFilename: true, logoMime: true, logoData: true, logoOnDarkFilename: true, logoOnDarkMime: true, logoOnDarkData: true },
  });
  const headerColor = row?.primaryColor && HEX.test(row.primaryColor) ? row.primaryColor.toLowerCase() : defaults.headerColor;
  const accentColor = row?.accentColor && HEX.test(row.accentColor) ? row.accentColor.toLowerCase() : defaults.accentColor;
  const onLight = row?.logoData && row.logoMime ? { filename: row.logoFilename ?? "logo", mime: row.logoMime, data: new Uint8Array(row.logoData) } : null;
  const onDark = row?.logoOnDarkData && row.logoOnDarkMime ? { filename: row.logoOnDarkFilename ?? "logo", mime: row.logoOnDarkMime, data: new Uint8Array(row.logoOnDarkData) } : null;
  const darkHeader = contrastText(headerColor) === "#ffffff";
  return { headerColor, accentColor, companyName: brand.name, logo: (darkHeader ? onDark ?? onLight : onLight ?? onDark) ?? null };
}
