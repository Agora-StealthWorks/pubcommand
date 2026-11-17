/**
 * Tickers mentioned in editorial (finance brands only). Prices come from market
 * data, never from the AI or the issue text.
 */

const TICKER = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;

/** "$NVDA, aapl  brk.b" → ["NVDA", "AAPL", "BRK.B"]. Anything that is not ticker-shaped is dropped. */
export function parseTickers(text: string, max = 20): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;/]+/)) {
    const t = raw.replace(/^\$/, "").trim().toUpperCase();
    if (t && TICKER.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}

export type DayBar = { date: string; close: number; high?: number | null };

export type TickerMetrics = { issueClose: number | null; peak: number | null; peakPct: number | null; current: number | null; currentPct: number | null };

const pct = (from: number | null, to: number | null) => (from && to != null ? Math.round(((to - from) / from) * 10000) / 100 : null);

/**
 * From daily bars: the close on the issue date (or the next trading day), the
 * highest close since, and the latest close, with % moves from the issue close.
 */
export function tickerMetrics(bars: DayBar[], issueDate: string): TickerMetrics {
  const since = bars.filter((b) => b.date >= issueDate && Number.isFinite(b.close)).sort((a, b) => a.date.localeCompare(b.date));
  if (!since.length) return { issueClose: null, peak: null, peakPct: null, current: null, currentPct: null };
  const issueClose = since[0]!.close;
  const peak = Math.max(...since.map((b) => b.close));
  const current = since[since.length - 1]!.close;
  return { issueClose, peak, peakPct: pct(issueClose, peak), current, currentPct: pct(issueClose, current) };
}

export type TickerMention = { ticker: string; issueId: string; title: string; publicationCode: string; mailDate: string };

/** One row per (ticker, issue) from issues that list tickers, newest first. */
export function tickerMentions(issues: { id: string; title: string; publicationCode: string; mailDate: string | null; tickers: string[] }[]): TickerMention[] {
  const out: TickerMention[] = [];
  for (const issue of issues) {
    if (!issue.mailDate) continue;
    for (const ticker of issue.tickers) out.push({ ticker, issueId: issue.id, title: issue.title, publicationCode: issue.publicationCode, mailDate: issue.mailDate });
  }
  return out.sort((a, b) => b.mailDate.localeCompare(a.mailDate) || a.ticker.localeCompare(b.ticker));
}
