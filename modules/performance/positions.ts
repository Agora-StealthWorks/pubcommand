/**
 * Recommendation fields, validation and the CSV import plan. Pure; the server writes what the plan says.
 */
import { occSymbol, parseSplitFactor, type Direction } from "./gain";

export const ASSET_TYPES = ["STOCK", "ETF", "OPTION", "OTHER"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_LABELS: Record<AssetType, string> = { STOCK: "Stock", ETF: "ETF", OPTION: "Option", OTHER: "Other" };

export type PositionDraft = {
  symbol: string;
  name: string;
  assetType: AssetType;
  direction: Direction;
  optionRight: "CALL" | "PUT" | null;
  strike: number | null;
  expiry: Date | null;
  entryDate: Date;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  exitDate: Date | null;
  exitPrice: number | null;
  weight: number;
  notes: string;
  /** Shares per entry share since entry, when a person states it. Null = detect from market data. */
  splitFactor: number | null;
  /** The symbol market data is fetched with (OCC for options). Null = not priced automatically. */
  priceSymbol: string | null;
};

export type DraftResult = { ok: true; draft: PositionDraft } | { ok: false; errors: string[] };

/** "$1,234.50" → 1234.5. Empty → null. Unreadable → NaN. */
export function parseMoney(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** YYYY-MM-DD, M/D/YYYY or M/D/YY → a UTC midnight Date. Empty → null. Unreadable → "invalid". */
export function parseDate(raw: string | null | undefined): Date | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let y: number;
  let m: number;
  let d: number;
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (isoMatch) {
    [y, m, d] = [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])];
  } else if (usMatch) {
    [m, d, y] = [Number(usMatch[1]), Number(usMatch[2]), Number(usMatch[3])];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
  } else {
    return "invalid";
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "invalid";
  return date;
}

function normDirection(raw: string): Direction | null {
  const text = raw.trim().toLowerCase();
  if (!text || ["long", "buy", "l", "bullish"].includes(text)) return "LONG";
  if (["short", "sell", "sell short", "s", "bearish"].includes(text)) return "SHORT";
  return null;
}

function normAsset(raw: string): AssetType | null {
  const text = raw.trim().toLowerCase();
  if (!text || ["stock", "equity", "share", "shares", "common"].includes(text)) return "STOCK";
  if (["etf", "fund"].includes(text)) return "ETF";
  if (["option", "options", "call", "put"].includes(text)) return "OPTION";
  if (text === "other") return "OTHER";
  return null;
}

/** Field values as strings, keyed by canonical names (see FIELD_ALIASES). */
export type RawPosition = Partial<Record<CanonicalField, string>>;

export function validatePosition(raw: RawPosition, today: Date): DraftResult {
  const errors: string[] = [];
  const symbol = String(raw.symbol ?? "").trim().toUpperCase();
  if (!symbol) errors.push("Symbol is required.");
  else if (!/^[A-Z0-9.\-^:/=&]{1,24}$/.test(symbol)) errors.push(`"${symbol}" is not a valid symbol.`);
  const direction = normDirection(String(raw.direction ?? ""));
  if (!direction) errors.push(`Direction "${raw.direction}" must be long or short.`);
  let assetType = normAsset(String(raw.assetType ?? ""));
  if (!assetType) errors.push(`Asset type "${raw.assetType}" must be stock, ETF, option or other.`);
  const rightText = String(raw.optionRight ?? raw.assetType ?? "").trim().toLowerCase();
  const optionRight = rightText === "call" || rightText === "c" ? "CALL" : rightText === "put" || rightText === "p" ? "PUT" : null;
  if (optionRight && assetType === "STOCK" && !raw.assetType) assetType = "OPTION";

  const entryDate = parseDate(raw.entryDate);
  if (entryDate === null) errors.push("Entry date is required.");
  else if (entryDate === "invalid") errors.push(`Entry date "${raw.entryDate}" is not a date.`);
  else if (entryDate.getTime() > today.getTime()) errors.push("Entry date is in the future.");
  const exitDate = parseDate(raw.exitDate);
  if (exitDate === "invalid") errors.push(`Exit date "${raw.exitDate}" is not a date.`);

  const money = (key: CanonicalField, label: string, required = false): number | null => {
    const value = parseMoney(raw[key]);
    if (value === null) {
      if (required) errors.push(`${label} is required.`);
      return null;
    }
    if (Number.isNaN(value) || value <= 0) {
      errors.push(`${label} "${raw[key]}" must be a positive number.`);
      return null;
    }
    return value;
  };
  const entryPrice = money("entryPrice", "Entry price", true);
  const exitPrice = money("exitPrice", "Exit price");
  const stopPrice = money("stopPrice", "Stop");
  const targetPrice = money("targetPrice", "Target");
  const strike = money("strike", "Strike");
  const expiry = parseDate(raw.expiry);
  if (expiry === "invalid") errors.push(`Expiry "${raw.expiry}" is not a date.`);

  if (exitPrice != null && exitDate == null) errors.push("A closed position needs an exit date.");
  if (exitPrice == null && exitDate instanceof Date && !raw.exitPrice?.trim()) errors.push("A closed position needs an exit price.");
  if (entryDate instanceof Date && exitDate instanceof Date && exitDate < entryDate) errors.push("Exit date is before the entry date.");

  const weightValue = parseMoney(raw.weight);
  const weight = weightValue == null ? 1 : weightValue;
  if (Number.isNaN(weight) || weight <= 0) errors.push(`Weight "${raw.weight}" must be a positive number.`);

  const splitText = String(raw.splitFactor ?? "").trim();
  const splitFactor = splitText ? parseSplitFactor(splitText) : null;
  if (splitText && splitFactor == null) errors.push(`Split "${splitText}" must look like 4:1 or 1:20.`);

  if (assetType === "OPTION" && (!optionRight || strike == null || !(expiry instanceof Date))) {
    errors.push("An option needs call/put, strike and expiry.");
  }
  if (errors.length) return { ok: false, errors };

  const priceSymbolRaw = String(raw.priceSymbol ?? "").trim().toUpperCase();
  const priceSymbol =
    priceSymbolRaw ||
    (assetType === "OPTION"
      ? occSymbol({ underlying: symbol, expiry: expiry as Date, right: optionRight as "CALL" | "PUT", strike: strike as number })
      : assetType === "OTHER"
        ? null
        : symbol);

  return {
    ok: true,
    draft: {
      symbol,
      name: String(raw.name ?? "").trim().slice(0, 200),
      assetType: assetType as AssetType,
      direction: direction as Direction,
      optionRight: assetType === "OPTION" ? optionRight : null,
      strike: assetType === "OPTION" ? strike : null,
      expiry: assetType === "OPTION" ? (expiry as Date) : null,
      entryDate: entryDate as Date,
      entryPrice: entryPrice as number,
      stopPrice,
      targetPrice,
      exitDate: exitPrice != null ? (exitDate as Date) : null,
      exitPrice,
      weight,
      notes: String(raw.notes ?? "").trim().slice(0, 4000),
      splitFactor,
      priceSymbol,
    },
  };
}

// ----------------------------------------------------------------------------- CSV

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF. Also reads tab-separated text pasted from a sheet. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const FIELD_ALIASES = {
  portfolio: ["portfolio", "publication", "service", "book", "pub"],
  symbol: ["symbol", "ticker", "underlying"],
  name: ["name", "company", "description", "position"],
  assetType: ["asset type", "asset", "type", "investment type", "instrument"],
  direction: ["direction", "side", "long/short", "action"],
  optionRight: ["option type", "call/put", "right", "put/call"],
  strike: ["strike", "strike price"],
  expiry: ["expiry", "expiration", "expiration date", "exp"],
  entryDate: ["entry date", "open date", "buy date", "date opened", "opened", "rec date", "date"],
  entryPrice: ["entry price", "entry", "buy price", "open price", "price"],
  stopPrice: ["stop", "stop loss", "stop price"],
  targetPrice: ["target", "target price", "price target"],
  exitDate: ["exit date", "close date", "sell date", "date closed", "closed"],
  exitPrice: ["exit price", "exit", "sell price", "close price"],
  weight: ["weight", "allocation"],
  notes: ["notes", "note", "comments", "position notes"],
  splitFactor: ["split", "splits", "split factor"],
  priceSymbol: ["price symbol", "data symbol"],
} as const;

export type CanonicalField = keyof typeof FIELD_ALIASES;

export const IMPORT_COLUMNS: CanonicalField[] = Object.keys(FIELD_ALIASES) as CanonicalField[];

function canonical(header: string): CanonicalField | null {
  const text = header.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [CanonicalField, readonly string[]][]) {
    if (aliases.includes(text)) return field;
  }
  return null;
}

export type ExistingPosition = { id: string; portfolioName: string; symbol: string; direction: Direction; entryDate: Date; status: "OPEN" | "CLOSED" };

export type ImportRowPlan = {
  line: number;
  portfolio: string;
  action: "create" | "close" | "skip" | "error";
  message: string;
  draft: PositionDraft | null;
  existingId: string | null;
};

export type ImportPlan = {
  rows: ImportRowPlan[];
  newPortfolios: string[];
  unknownColumns: string[];
  counts: { create: number; close: number; skip: number; error: number };
};

export const MAX_IMPORT_ROWS = 2000;

const keyOf = (portfolio: string, symbol: string, direction: string, entryDate: Date) =>
  `${portfolio.trim().toLowerCase()}|${symbol}|${direction}|${entryDate.toISOString().slice(0, 10)}`;

/**
 * Dry run: what an import would do, row by row. A row that matches an existing recommendation (same portfolio,
 * symbol, direction and entry date) is skipped, unless the stored one is open and the row closes it.
 */
export function planImport(input: {
  csv: string;
  defaultPortfolio: string;
  portfolios: readonly string[];
  existing: readonly ExistingPosition[];
  today: Date;
}): ImportPlan {
  const table = parseCsv(input.csv);
  const empty: ImportPlan = { rows: [], newPortfolios: [], unknownColumns: [], counts: { create: 0, close: 0, skip: 0, error: 0 } };
  if (table.length < 2) return { ...empty, rows: [{ line: 1, portfolio: "", action: "error", message: "Paste a header row and at least one recommendation.", draft: null, existingId: null }], counts: { ...empty.counts, error: 1 } };
  const header = table[0] as string[];
  const fields = header.map(canonical);
  const unknownColumns = header.filter((_, i) => !fields[i]).map((h) => h.trim()).filter(Boolean);
  const known = new Map(input.portfolios.map((name) => [name.trim().toLowerCase(), name]));
  const existing = new Map(input.existing.map((p) => [keyOf(p.portfolioName, p.symbol, p.direction, p.entryDate), p]));
  const seen = new Set<string>();
  const created = new Set<string>();
  const rows: ImportRowPlan[] = [];

  for (const [index, cells] of table.slice(1, MAX_IMPORT_ROWS + 1).entries()) {
    const line = index + 2;
    const raw: RawPosition = {};
    fields.forEach((field, i) => {
      if (field && raw[field] === undefined) raw[field] = cells[i] ?? "";
    });
    const portfolioRaw = String(raw.portfolio ?? "").trim() || input.defaultPortfolio.trim();
    if (!portfolioRaw) {
      rows.push({ line, portfolio: "", action: "error", message: "No portfolio: add a portfolio column or pick one.", draft: null, existingId: null });
      continue;
    }
    const portfolio = known.get(portfolioRaw.toLowerCase()) ?? portfolioRaw.slice(0, 120);
    if (!known.has(portfolio.toLowerCase())) created.add(portfolio);
    const result = validatePosition(raw, input.today);
    if (!result.ok) {
      rows.push({ line, portfolio, action: "error", message: result.errors.join(" "), draft: null, existingId: null });
      continue;
    }
    const draft = result.draft;
    const key = keyOf(portfolio, draft.symbol, draft.direction, draft.entryDate);
    if (seen.has(key)) {
      rows.push({ line, portfolio, action: "skip", message: "Repeats an earlier row in this file.", draft, existingId: null });
      continue;
    }
    seen.add(key);
    const match = existing.get(key);
    if (match) {
      if (match.status === "OPEN" && draft.exitPrice != null) {
        rows.push({ line, portfolio, action: "close", message: `Closes the open ${draft.symbol} at ${draft.exitPrice}.`, draft, existingId: match.id });
      } else {
        rows.push({ line, portfolio, action: "skip", message: "Already recorded.", draft, existingId: match.id });
      }
      continue;
    }
    rows.push({ line, portfolio, action: "create", message: draft.exitPrice != null ? "New closed recommendation." : "New open recommendation.", draft, existingId: null });
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    rows.push({ line: MAX_IMPORT_ROWS + 2, portfolio: "", action: "error", message: `Only the first ${MAX_IMPORT_ROWS} rows are imported at once.`, draft: null, existingId: null });
  }
  const counts = { create: 0, close: 0, skip: 0, error: 0 };
  for (const row of rows) counts[row.action] += 1;
  const usedPortfolios = new Set(rows.filter((r) => r.action === "create").map((r) => r.portfolio));
  return { rows, newPortfolios: [...created].filter((name) => usedPortfolios.has(name)), unknownColumns, counts };
}

/** A CSV cell: quoted when needed, and guarded against spreadsheet formula injection. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
