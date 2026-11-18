import { tenantDb } from "@pubcommand/db";
import { isStale } from "./server";

export type PromoListItem = {
  id: string;
  title: string;
  status: string;
  score: number | null;
  createdAt: Date;
  publisher: string | null;
  isBestPerformer: boolean;
};

export async function listPromos(organizationId: string, brandId: string, q: string): Promise<PromoListItem[]> {
  const query = q.trim();
  const rows = await tenantDb(organizationId).promo.findMany({
    where: {
      brandId,
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { publisher: { contains: query, mode: "insensitive" as const } },
              { product: { contains: query, mode: "insensitive" as const } },
              { promoCode: { contains: query, mode: "insensitive" as const } },
              { gurus: { has: query } },
            ],
          }
        : {}),
    },
    select: { id: true, title: true, analysisStatus: true, effectivenessScore: true, createdAt: true, updatedAt: true, publisher: true, isBestPerformer: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: isStale(row.analysisStatus, row.updatedAt) ? "FAILED" : row.analysisStatus,
    score: row.effectivenessScore,
    createdAt: row.createdAt,
    publisher: row.publisher,
    isBestPerformer: row.isBestPerformer,
  }));
}

export async function loadPromo(organizationId: string, brandId: string, promoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(promoId)) return null;
  const db = tenantDb(organizationId);
  const promo = await db.promo.findFirst({ where: { id: promoId, brandId, deletedAt: null } });
  if (!promo) return null;
  const [analyses, files] = await Promise.all([
    db.promoAnalysis.findMany({ where: { promoId }, orderBy: { version: "desc" }, select: { id: true, version: true, model: true, score: true, createdAt: true, result: true } }),
    db.promoFile.findMany({ where: { promoId }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, category: true, filename: true, size: true, mimeType: true, createdAt: true } }),
  ]);
  const stale = isStale(promo.analysisStatus, promo.updatedAt);
  return {
    promo: {
      ...promo,
      analysisStatus: stale ? ("FAILED" as const) : promo.analysisStatus,
      analysisError: stale ? "The analysis was interrupted (the server restarted). Run it again." : promo.analysisError,
      pricePoint: promo.pricePoint == null ? null : Number(promo.pricePoint),
    },
    /** The newest analysis; `result` is either saved shape (see stored.ts `isStoredV2`). */
    current: analyses[0] ? { ...analyses[0], result: analyses[0].result as unknown } : null,
    history: analyses.map(({ result: _result, ...rest }) => rest),
    files,
  };
}

export type LoadedPromo = NonNullable<Awaited<ReturnType<typeof loadPromo>>>;
