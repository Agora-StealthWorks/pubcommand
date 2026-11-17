/**
 * Pasted or uploaded price data, for anything the providers cannot supply.
 * Accepts a header row with a date column and a value column (close, adj close, value, price, last), or
 * date,open,high,low,close. Comma, semicolon or tab separated; quoted cells allowed.
 * Dates: YYYY-MM-DD, MM/DD/YYYY, MM/DD/YY, YYYY-MM, YYYY, or anything Date.parse reads.
 */
import { MarketError, type Bar } from "./types";

const MAX_ROWS = 50_000;

function splitRow(line: string, sep: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === sep) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvDate(raw: string): number {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const short = (m[3] as string).length === 2;
    const year = short ? (Number(m[3]) < 50 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
    return Date.UTC(year, Number(m[1]) - 1, Number(m[2]));
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  m = /^(\d{4})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), 0, 1);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Number.NaN;
}

function parseNumber(raw: string | undefined): number {
  if (raw == null) return Number.NaN;
  const cleaned = raw.replace(/[$,%\s]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

export interface CsvBars {
  bars: Bar[];
  /** Header of the value column, e.g. "close" or "readers". */
  valueLabel: string;
  skipped: number;
}

export function parseBarsCsv(text: string): CsvBars {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new MarketError("bad_request", "The CSV needs a header row and at least two rows of data.");
  if (lines.length > MAX_ROWS) throw new MarketError("bad_request", `Use ${MAX_ROWS.toLocaleString("en-US")} rows or fewer.`);
  const first = lines[0] as string;
  const sep = first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",";
  const head = splitRow(first, sep).map((cell) => cell.toLowerCase());
  const hasHeader = !Number.isFinite(parseCsvDate(head[0] ?? "")) || head.some((cell) => /[a-z]{3}/.test(cell) && !Number.isFinite(parseCsvDate(cell)));
  const find = (...names: string[]) => {
    for (const name of names) {
      const exact = head.indexOf(name);
      if (exact >= 0) return exact;
    }
    return head.findIndex((cell) => names.some((name) => cell.includes(name)));
  };
  const dateCol = hasHeader ? Math.max(0, find("date", "time", "period", "day", "month", "year")) : 0;
  let valueCol = hasHeader ? find("adj close", "adj_close", "close", "value", "price", "last") : 1;
  if (valueCol < 0 || valueCol === dateCol) valueCol = dateCol === 0 ? 1 : 0;
  const openCol = hasHeader ? find("open") : -1;
  const highCol = hasHeader ? find("high") : -1;
  const lowCol = hasHeader ? find("low") : -1;

  const bars: Bar[] = [];
  let skipped = 0;
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = splitRow(line, sep);
    const t = parseCsvDate(cells[dateCol] ?? "");
    const c = parseNumber(cells[valueCol]);
    if (!Number.isFinite(t) || !Number.isFinite(c)) {
      skipped += 1;
      continue;
    }
    const pick = (col: number) => {
      const value = col >= 0 ? parseNumber(cells[col]) : Number.NaN;
      return Number.isFinite(value) ? value : c;
    };
    bars.push({ t, o: pick(openCol), h: pick(highCol), l: pick(lowCol), c });
  }
  if (bars.length < 2) throw new MarketError("bad_request", "Could not read at least two dated numbers from the CSV.");
  bars.sort((a, b) => a.t - b.t);
  const deduped = bars.filter((bar, index) => index === 0 || bar.t !== (bars[index - 1] as Bar).t);
  return { bars: deduped, valueLabel: hasHeader ? (head[valueCol] ?? "value") : "value", skipped };
}
