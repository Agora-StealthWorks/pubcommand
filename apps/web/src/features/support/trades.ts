import { tenantDb } from "@pubcommand/db";
import { checkTradeQuery, selectTrades, tradeAnswer, type TradeQuery, type TradeRow } from "../../../../../modules/support/trades";

/**
 * Track-record lookups for finance brands, read live from Track Record (never copied).
 * Public-safe data only: portfolios the brand has published (public link on), closed
 * positions only. The rules (no ranking, a filter required, ordered by close date) live in
 * modules/support/trades.ts.
 */
export async function lookupTrades(organizationId: string, brandId: string, query: TradeQuery): Promise<{ ok: true; trades: ReturnType<typeof tradeAnswer> } | { ok: false; message: string }> {
  const check = checkTradeQuery(query);
  if (!check.ok) return check;
  const { ticker, from, to } = check.filters;
  const db = tenantDb(organizationId);
  const rows = await db.trackPosition.findMany({
    where: {
      brandId,
      deletedAt: null,
      status: "CLOSED",
      exitDate: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
      exitPrice: { not: null },
      ...(ticker ? { symbol: ticker } : {}),
      portfolio: { deletedAt: null, publicEnabled: true },
    },
    orderBy: [{ exitDate: "desc" }],
    take: 200,
    select: {
      symbol: true,
      name: true,
      direction: true,
      status: true,
      entryDate: true,
      entryPrice: true,
      exitDate: true,
      exitPrice: true,
      portfolio: { select: { name: true, publication: true } },
    },
  });
  const flat: TradeRow[] = rows.map((r) => ({ ...r, portfolio: r.portfolio.name, publication: r.portfolio.publication }));
  return { ok: true, trades: tradeAnswer(selectTrades(flat, check.filters)) };
}
