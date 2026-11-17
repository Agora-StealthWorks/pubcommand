import { brandProfile } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { createMarket, isoDate, memoryCache, MarketError, type Market } from "@pubcommand/market";
import { fromDay, toDay } from "../../../../../modules/editorial/dates";
import { tickerMentions, tickerMetrics } from "../../../../../modules/editorial/tickers";

/** Tickers are a finance-brand view: other niches never see it. */
export function showsTickers(brand: { name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null }): boolean {
  return brandProfile(brand).niche === "finance";
}

export function marketConfigured(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY || process.env.TIINGO_API_KEY);
}

function makeMarket(): Market {
  return createMarket({ massiveKey: process.env.MASSIVE_API_KEY || null, massiveBaseUrl: process.env.MASSIVE_BASE_URL || undefined, tiingoKey: process.env.TIINGO_API_KEY || null, cache: memoryCache() });
}

/** Ticker mentions of a brand's live issues joined with their stored prices. */
export async function loadTickerRows(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const [issues, prices] = await Promise.all([
    db.calendarIssue.findMany({ where: { brandId, deletedAt: null, NOT: { tickers: { isEmpty: true } } }, select: { id: true, title: true, publicationCode: true, mailDate: true, tickers: true }, take: 3000 }),
    db.calendarTickerPrice.findMany({ where: { brandId }, take: 10000 }),
  ]);
  const byKey = new Map(prices.map((p) => [`${p.ticker}|${toDay(p.issueDate)}`, p]));
  return tickerMentions(issues.map((i) => ({ ...i, mailDate: toDay(i.mailDate) }))).map((m) => ({ ...m, price: byKey.get(`${m.ticker}|${m.mailDate}`) ?? null }));
}

/**
 * Refresh stored prices for every (ticker, issue date) a brand mentions. Prices
 * come from market data; an unpriceable symbol is stored with its error.
 */
export async function refreshTickerPrices(organizationId: string, brandId: string, market: Market = makeMarket(), limit = 150) {
  const db = tenantDb(organizationId);
  const today = isoDate(Date.now());
  const issues = await db.calendarIssue.findMany({ where: { brandId, deletedAt: null, NOT: { tickers: { isEmpty: true } }, mailDate: { lte: fromDay(today)! } }, select: { id: true, title: true, publicationCode: true, mailDate: true, tickers: true }, take: 3000 });
  const pairs = new Map<string, { ticker: string; day: string }>();
  for (const m of tickerMentions(issues.map((i) => ({ ...i, mailDate: toDay(i.mailDate) })))) pairs.set(`${m.ticker}|${m.mailDate}`, { ticker: m.ticker, day: m.mailDate });
  let priced = 0;
  let failed = 0;
  for (const { ticker, day } of [...pairs.values()].slice(0, limit)) {
    let data: { issueClose: number | null; peak: number | null; peakPct: number | null; current: number | null; currentPct: number | null; source: string | null; error: string | null };
    try {
      const series = await market.dailyBars(ticker, day, today);
      const metrics = tickerMetrics(series.bars.map((b) => ({ date: isoDate(b.t), close: b.c })), day);
      data = { ...metrics, source: series.source, error: metrics.issueClose == null ? "No prices since the issue date." : null };
      priced += metrics.issueClose == null ? 0 : 1;
    } catch (error) {
      failed += 1;
      data = { issueClose: null, peak: null, peakPct: null, current: null, currentPct: null, source: null, error: error instanceof MarketError || error instanceof Error ? error.message.slice(0, 200) : "No price." };
    }
    const existing = await db.calendarTickerPrice.findFirst({ where: { brandId, ticker, issueDate: fromDay(day)! }, select: { id: true } });
    if (existing) await db.calendarTickerPrice.updateMany({ where: { id: existing.id }, data: { ...data, fetchedAt: new Date() } });
    else await db.calendarTickerPrice.create({ data: { organizationId, brandId, ticker, issueDate: fromDay(day)!, ...data, fetchedAt: new Date() } });
  }
  return { pairs: pairs.size, priced, failed };
}
