import type { tenantDb } from "@pubcommand/db";
import { currentAnalysis } from "../../../../../modules/promo-studio/stored";

type Db = ReturnType<typeof tenantDb>;

/** The promo's current analysis row: the newest complete one (a run that stopped early never replaces it). */
export async function currentAnalysisRow(db: Db, promoId: string) {
  const rows = await db.promoAnalysis.findMany({ where: { promoId }, orderBy: { version: "desc" }, take: 25 });
  return currentAnalysis(rows);
}

/** The current analysis per promo, from rows ordered newest first. */
export function currentByPromo<T extends { promoId: string; result: unknown }>(rowsNewestFirst: readonly T[]): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const row of rowsNewestFirst) grouped.set(row.promoId, [...(grouped.get(row.promoId) ?? []), row]);
  const out = new Map<string, T>();
  for (const [promoId, rows] of grouped) {
    const pick = currentAnalysis(rows);
    if (pick) out.set(promoId, pick);
  }
  return out;
}
