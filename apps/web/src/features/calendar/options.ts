import { tenantDb } from "@pubcommand/db";
import { resolveOptions, type OptionLists } from "../../../../../modules/editorial/options";
import { listPromos, type PromoRow } from "./promos";
import { showsTickers } from "./tickers";

/** The brand's dropdown options for every field (built-in defaults where the brand has none). */
export async function loadOptions(organizationId: string, brandId: string): Promise<OptionLists> {
  const rows = await tenantDb(organizationId).calendarFieldOption.findMany({
    where: { brandId },
    select: { field: true, value: true, sortOrder: true },
    take: 2000,
  });
  return resolveOptions(rows);
}

export type FormExtras = { options: OptionLists; promos: PromoRow[]; tickers: boolean };

/** What the event and issue forms need beyond the record: option lists, promos to link, and whether tickers show. */
export async function loadFormExtras(organizationId: string, brand: { id: string; name: string; niche?: string | null }): Promise<FormExtras> {
  const [options, promos] = await Promise.all([loadOptions(organizationId, brand.id), listPromos(organizationId, brand.id)]);
  return { options, promos, tickers: showsTickers(brand) };
}
