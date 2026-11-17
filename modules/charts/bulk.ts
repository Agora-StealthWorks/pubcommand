/**
 * Bulk rows: one chart per line, one design for the whole run.
 *   ticker, period-or-dates, title, headline, timeframe
 * period is a chip (1Y, 5Y, YTD, ...) or "2020-01-01..2024-12-31". Title, headline and timeframe are
 * optional; blanks use the template. A header line starting with "ticker" is skipped.
 */
import { CHART_PERIODS, INTERVALS, type ChartInterval, type ChartPeriod } from "./spec";

export const BULK_MAX_ROWS = 100;
export const BULK_CONCURRENCY = 4;

export type BulkRow = {
  line: number;
  symbol: string;
  period: ChartPeriod;
  from: string | null;
  to: string | null;
  title: string | null;
  headline: string | null;
  interval: ChartInterval;
};

export type BulkParse = { rows: BulkRow[]; errors: string[] };

function cells(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === "\t") {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  out.push(current.trim());
  return out;
}

const TIMEFRAMES: Record<string, ChartInterval> = { daily: "day", day: "day", d: "day", weekly: "week", week: "week", w: "week", monthly: "month", month: "month", m: "month" };

export function parseBulkRows(text: string): BulkParse {
  const rows: BulkRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim() || raw.trim().startsWith("#")) return;
    const [symbolRaw = "", periodRaw = "", title = "", headline = "", timeframe = ""] = cells(raw);
    if (index === 0 && /^(ticker|symbol)$/i.test(symbolRaw)) return;
    const symbol = symbolRaw.toUpperCase();
    if (!/^[A-Z0-9.\-^:/& ]{1,40}$/i.test(symbolRaw) || /^CSV$/i.test(symbol)) {
      errors.push(`Line ${line}: "${symbolRaw}" is not a ticker.`);
      return;
    }
    let period: ChartPeriod = "1Y";
    let from: string | null = null;
    let to: string | null = null;
    const range = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|–|—)\s*(\d{4}-\d{2}-\d{2})$/i.exec(periodRaw);
    if (range) {
      period = "CUSTOM";
      from = range[1] as string;
      to = range[2] as string;
      if (from > to) {
        errors.push(`Line ${line}: the start date is after the end date.`);
        return;
      }
    } else if (periodRaw) {
      const chip = periodRaw.toUpperCase() as ChartPeriod;
      if (!(CHART_PERIODS as readonly string[]).includes(chip) || chip === "CUSTOM") {
        errors.push(`Line ${line}: period "${periodRaw}" should be like 1Y, 5Y, YTD or 2020-01-01..2024-12-31.`);
        return;
      }
      period = chip;
    }
    const interval = timeframe ? (TIMEFRAMES[timeframe.toLowerCase()] ?? ((INTERVALS as readonly string[]).includes(timeframe) ? (timeframe as ChartInterval) : null)) : "day";
    if (!interval || interval === "hour" || interval === "5min") {
      errors.push(`Line ${line}: timeframe "${timeframe}" should be daily, weekly or monthly.`);
      return;
    }
    rows.push({ line, symbol: symbol.replace(/\s+/g, ""), period, from, to, title: title || null, headline: headline || null, interval });
  });
  if (rows.length > BULK_MAX_ROWS) {
    errors.push(`A run makes up to ${BULK_MAX_ROWS} charts; you entered ${rows.length}.`);
    return { rows: rows.slice(0, BULK_MAX_ROWS), errors };
  }
  return { rows, errors };
}

/** Run `task` over `items`, `limit` at a time, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
