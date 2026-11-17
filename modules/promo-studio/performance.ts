/**
 * Promo Analyzer performance: read a results sheet (CSV or XLSX), map its
 * columns, sum rows per promo code, and rank each promo against promos of the
 * same type. Pure functions, unit tested; the numbers here come from the
 * sheet, never from the AI.
 */
import { strFromU8, unzipSync } from "fflate";

// ---------------------------------------------------------------------------
// Reading files

/** Parse CSV (or semicolon / tab separated) text into rows of cells. Handles quotes, embedded newlines and a BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  const [best, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  const delimiter = bestCount > 0 ? best : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += char;
      continue;
    }
    if (char === '"' && cell === "") inQuotes = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Read the first worksheet of an .xlsx file into rows of cells (strings; numbers as written). */
export function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, { filter: (file) => file.name.startsWith("xl/") });
  const read = (name: string) => (files[name] ? strFromU8(files[name]!) : "");
  const shared: string[] = [];
  for (const match of read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!));
    shared.push(parts.join(""));
  }
  // First sheet in workbook order.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = read("xl/workbook.xml").match(/<sheet\b[^>]*r:id="([^"]+)"/);
  if (firstSheet) {
    const rel = read("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`))
      ?? read("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${firstSheet[1]}"`));
    if (rel) sheetPath = rel[1]!.startsWith("/") ? rel[1]!.slice(1) : `xl/${rel[1]!.replace(/^\.\//, "")}`;
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error("That spreadsheet has no readable first sheet.");
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/);
      const index = ref ? columnIndex(ref[1]!) : next;
      next = index + 1;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && raw != null) value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!)).join("");
      else if (raw != null) value = decodeXml(raw);
      while (row.length < index) row.push("");
      row[index] = value.trim();
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Parse an uploaded results file by its name. */
export function parseSheet(filename: string, bytes: Uint8Array): string[][] {
  if (/\.xlsx$/i.test(filename)) return parseXlsx(bytes);
  if (/\.(csv|tsv|txt)$/i.test(filename)) return parseCsv(new TextDecoder().decode(bytes));
  throw new Error("Upload a .csv or .xlsx file.");
}

// ---------------------------------------------------------------------------
// Column mapping

export const PERFORMANCE_FIELDS = [
  { key: "code", label: "Promo / creative code", required: true, hints: ["promo code", "creative code", "creative", "promo id", "code", "effort", "campaign code", "source code", "key code"] },
  { key: "label", label: "Promo name", required: false, hints: ["promo name", "creative name", "campaign name", "name", "title", "description"] },
  { key: "promoType", label: "Promo type", required: false, hints: ["promo type", "type", "offer type", "funnel"] },
  { key: "startDate", label: "Start date", required: false, hints: ["start date", "launch date", "mail date", "drop date", "start", "date"] },
  { key: "endDate", label: "End date", required: false, hints: ["end date", "stop date", "end"] },
  { key: "sent", label: "Mailed / sent", required: false, hints: ["mailed", "sent", "delivered", "list size", "quantity", "volume"] },
  { key: "views", label: "Page views", required: false, hints: ["promotion views", "page views", "views", "visits", "sessions"] },
  { key: "clicks", label: "Clicks", required: false, hints: ["clicks", "order form clicks", "unique clicks", "click"] },
  { key: "orders", label: "Orders", required: false, hints: ["orders", "sales", "units", "conversions", "buyers"] },
  { key: "revenue", label: "Revenue", required: false, hints: ["net revenue", "gross revenue", "revenue", "sales $", "dollars", "amount"] },
  { key: "cost", label: "Cost", required: false, hints: ["cost", "spend", "media cost", "list cost", "expense"] },
] as const;

export type PerformanceFieldKey = (typeof PERFORMANCE_FIELDS)[number]["key"];
/** field -> column index in the sheet (or -1 for none). */
export type ColumnMapping = Record<PerformanceFieldKey, number>;

const squashHeader = (value: string) => value.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Guess which column feeds which field: exact hint first, then a header containing a hint. Each column is used once. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(squashHeader);
  const used = new Set<number>();
  const mapping = {} as ColumnMapping;
  for (const field of PERFORMANCE_FIELDS) mapping[field.key] = -1;
  for (const pass of ["exact", "contains"] as const) {
    for (const field of PERFORMANCE_FIELDS) {
      if (mapping[field.key] !== -1) continue;
      for (const hint of field.hints) {
        const index = normalized.findIndex((header, i) => !used.has(i) && (pass === "exact" ? header === hint : header.includes(hint)));
        if (index >= 0) {
          mapping[field.key] = index;
          used.add(index);
          break;
        }
      }
    }
  }
  return mapping;
}

/** "$1,234.50" -> 1234.5, "(200)" -> -200, "12%" -> 12, "1.2K" -> 1200. Blank or junk -> null. */
export function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  let text = value.trim();
  if (!text || /^(n\/?a|-+|—|none|null)$/i.test(text)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$€£,\s%]/g, "");
  let multiplier = 1;
  const suffix = text.match(/([kmb])$/i);
  if (suffix) {
    multiplier = { k: 1e3, m: 1e6, b: 1e9 }[suffix[1]!.toLowerCase() as "k" | "m" | "b"];
    text = text.slice(0, -1);
  }
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(text)) return null;
  const number = Number(text) * multiplier;
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

/** ISO, M/D/YYYY, M/D/YY or an Excel serial day number -> a UTC date (or null). */
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return safeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) {
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return safeDate(year, Number(match[1]), Number(match[2]));
  }
  if (/^\d{4,5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  }
  return null;
}

function safeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date : null;
}

/** Upper case, letters and digits only: "fe-123 a" -> "FE123A". */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A promo can list several codes ("ABC1, ABC2"). */
export function promoCodeKeys(promoCode: string | null | undefined): string[] {
  if (!promoCode) return [];
  return [...new Set(promoCode.split(/[,;\n]+/).map(normalizeCode).filter(Boolean))];
}

export type PerformanceRow = {
  codeKey: string;
  promoCode: string;
  label: string | null;
  sheetType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  sent: number | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  revenue: number | null;
  cost: number | null;
  /** Columns that were not mapped, from the first row for this code. */
  extra: Record<string, string>;
  /** Sheet rows summed into this one. */
  rows: number;
};

const NUMERIC = ["sent", "views", "clicks", "orders", "revenue", "cost"] as const;

/** Turn sheet rows into one record per promo code, summing numbers and widening dates. */
export function mapRows(table: readonly (readonly string[])[], mapping: ColumnMapping): { rows: PerformanceRow[]; skipped: number } {
  const [headers = [], ...body] = table;
  const mappedIndexes = new Set(Object.values(mapping).filter((i) => i >= 0));
  const byCode = new Map<string, PerformanceRow>();
  let skipped = 0;
  const cell = (row: readonly string[], key: PerformanceFieldKey) => (mapping[key] >= 0 ? row[mapping[key]] ?? "" : "");
  for (const line of body) {
    const promoCode = cell(line, "code").trim();
    const codeKey = normalizeCode(promoCode);
    if (!codeKey || /^(total|grand total|sum)$/i.test(promoCode)) {
      skipped += 1;
      continue;
    }
    const start = parseDate(cell(line, "startDate"));
    const end = parseDate(cell(line, "endDate"));
    const existing = byCode.get(codeKey);
    if (!existing) {
      const extra: Record<string, string> = {};
      headers.forEach((header, i) => {
        if (!mappedIndexes.has(i) && header && line[i]) extra[header.slice(0, 80)] = String(line[i]).slice(0, 200);
      });
      const row: PerformanceRow = {
        codeKey,
        promoCode: promoCode.slice(0, 80),
        label: cell(line, "label").slice(0, 200) || null,
        sheetType: cell(line, "promoType").slice(0, 80) || null,
        startDate: start,
        endDate: end,
        sent: null,
        views: null,
        clicks: null,
        orders: null,
        revenue: null,
        cost: null,
        extra,
        rows: 0,
      };
      byCode.set(codeKey, row);
    }
    const row = byCode.get(codeKey)!;
    row.rows += 1;
    for (const key of NUMERIC) {
      const value = parseNumber(cell(line, key));
      if (value != null) row[key] = (row[key] ?? 0) + value;
    }
    if (start && (!row.startDate || start < row.startDate)) row.startDate = start;
    if (end && (!row.endDate || end > row.endDate)) row.endDate = end;
    if (!row.label) row.label = cell(line, "label").slice(0, 200) || null;
    if (!row.sheetType) row.sheetType = cell(line, "promoType").slice(0, 80) || null;
  }
  return { rows: [...byCode.values()], skipped };
}

// ---------------------------------------------------------------------------
// Enrichment and tiers

export type Enriched = {
  clickRate: number | null;
  conversion: number | null;
  revenuePerThousand: number | null;
  epc: number | null;
  roi: number | null;
  averageOrder: number | null;
};

const ratio = (top: number | null, bottom: number | null, scale = 1) => (top != null && bottom != null && bottom > 0 ? (top / bottom) * scale : null);

/** Rates we compute from the summed counts. */
export function enrich(row: Pick<PerformanceRow, "sent" | "views" | "clicks" | "orders" | "revenue" | "cost">): Enriched {
  return {
    clickRate: ratio(row.clicks, row.sent ?? row.views, 100),
    conversion: ratio(row.orders, row.clicks ?? row.views, 100),
    revenuePerThousand: ratio(row.revenue, row.sent, 1000),
    epc: ratio(row.revenue, row.clicks),
    roi: row.revenue != null && row.cost != null && row.cost > 0 ? ((row.revenue - row.cost) / row.cost) * 100 : null,
    averageOrder: ratio(row.revenue, row.orders),
  };
}

/** Cohort of n >= 20 gets five tiers; 8 to 19 gets three; fewer than 8 gets none. */
export const FIVE_TIER_MIN = 20;
export const THREE_TIER_MIN = 8;

export type TierScheme = "5-tier" | "3-tier";
export type TierKey = "top10" | "upper" | "middle" | "lower" | "bottom10" | "top25" | "middle50" | "bottom25";

/** Tiers are percentile bands, labelled as statistics, not grades. */
export const TIER_LABELS: Record<TierKey, string> = {
  top10: "Top 10%",
  upper: "Top 10–35%",
  middle: "Middle 35%",
  lower: "Bottom 10–30%",
  bottom10: "Bottom 10%",
  top25: "Top 25%",
  middle50: "Middle 50%",
  bottom25: "Bottom 25%",
};

export const TIER_TONE: Record<TierKey, "ok" | "accent" | "neutral" | "warn" | "danger"> = {
  top10: "ok",
  upper: "accent",
  middle: "neutral",
  lower: "warn",
  bottom10: "danger",
  top25: "ok",
  middle50: "neutral",
  bottom25: "warn",
};

export function tierFor(percentile: number, scheme: TierScheme): TierKey {
  if (scheme === "5-tier") {
    if (percentile >= 0.9) return "top10";
    if (percentile >= 0.65) return "upper";
    if (percentile >= 0.3) return "middle";
    if (percentile >= 0.1) return "lower";
    return "bottom10";
  }
  if (percentile >= 0.75) return "top25";
  if (percentile >= 0.25) return "middle50";
  return "bottom25";
}

export function schemeFor(cohortSize: number): TierScheme | null {
  if (cohortSize >= FIVE_TIER_MIN) return "5-tier";
  if (cohortSize >= THREE_TIER_MIN) return "3-tier";
  return null;
}

/** Front-end promos win buyers, so they rank on orders; every other type ranks on revenue. Falls back to the other when missing. */
export function rankMetric(cohort: string, row: { orders: number | null; revenue: number | null }): { metric: "orders" | "revenue"; value: number } | null {
  const primary = cohort === "Front-end" ? "orders" : "revenue";
  const secondary = primary === "orders" ? "revenue" : "orders";
  if (row[primary] != null) return { metric: primary, value: row[primary]! };
  if (row[secondary] != null) return { metric: secondary, value: row[secondary]! };
  return null;
}

export type TierInput = { codeKey: string; cohort: string; orders: number | null; revenue: number | null };
export type TierResult = {
  codeKey: string;
  cohort: string;
  cohortSize: number;
  metric: "orders" | "revenue" | null;
  metricValue: number | null;
  /** Share of cohort peers this promo beats (ties count half). */
  percentile: number | null;
  scheme: TierScheme | null;
  tier: TierKey | null;
};

/**
 * Rank every record against the others in its cohort (promo type) on the
 * cohort's metric. A promo is never compared with itself. Records are only
 * pooled with peers that rank on the same metric.
 */
export function computeTiers(records: readonly TierInput[]): TierResult[] {
  const valued = records.map((record) => ({ record, ranked: rankMetric(record.cohort, record) }));
  const pools = new Map<string, { codeKey: string; value: number }[]>();
  for (const { record, ranked } of valued) {
    if (!ranked) continue;
    const key = `${record.cohort}\u0000${ranked.metric}`;
    const pool = pools.get(key) ?? [];
    pool.push({ codeKey: record.codeKey, value: ranked.value });
    pools.set(key, pool);
  }
  return valued.map(({ record, ranked }) => {
    if (!ranked) return { codeKey: record.codeKey, cohort: record.cohort, cohortSize: 0, metric: null, metricValue: null, percentile: null, scheme: null, tier: null };
    const pool = pools.get(`${record.cohort}\u0000${ranked.metric}`)!;
    const scheme = schemeFor(pool.length);
    const peers = pool.filter((peer) => peer.codeKey !== record.codeKey);
    const beaten = peers.filter((peer) => peer.value < ranked.value).length;
    const tied = peers.filter((peer) => peer.value === ranked.value).length;
    const percentile = peers.length ? Math.round(((beaten + tied / 2) / peers.length) * 1000) / 1000 : null;
    return {
      codeKey: record.codeKey,
      cohort: record.cohort,
      cohortSize: pool.length,
      metric: ranked.metric,
      metricValue: ranked.value,
      percentile,
      scheme,
      tier: scheme && percentile != null ? tierFor(percentile, scheme) : null,
    };
  });
}

/** 1-10 real-world score from a percentile, used where no person entered one. */
export function percentileScore(percentile: number | null): number | null {
  if (percentile == null) return null;
  return Math.round((1 + 9 * Math.min(1, Math.max(0, percentile))) * 10) / 10;
}

/** "top 8% by revenue among 24 Backend VSL promos" */
export function describeTier(result: { percentile: number | null; metric: string | null; cohortSize: number | null; cohort: string | null; scheme?: string | null; tierScheme?: string | null }): string {
  if (!result.metric) return "Not ranked: no orders or revenue for this code.";
  if (!(result.scheme ?? result.tierScheme) || result.percentile == null) return `Not tiered: only ${result.cohortSize ?? 0} ${result.cohort ?? ""} promos have results (8 needed).`;
  const p = result.percentile;
  const rank = p >= 0.5 ? `top ${Math.max(1, Math.round((1 - p) * 100))}%` : `bottom ${Math.max(1, Math.round(p * 100))}%`;
  return `${rank} by ${result.metric} among ${result.cohortSize} ${result.cohort} promos`;
}

/** The cohort a performance record belongs to: the matched promo's type, else the sheet's type column, else Unclassified. */
export function cohortFor(promoType: string | null | undefined, sheetType: string | null | undefined, knownTypes: readonly string[]): string {
  if (promoType) return promoType;
  if (sheetType) {
    const hit = knownTypes.find((type) => type.toLowerCase() === sheetType.trim().toLowerCase());
    if (hit) return hit;
    if (/front/i.test(sheetType)) return "Front-end";
  }
  return "Unclassified";
}

/** Aggregate lessons for the brand Brain: cohort sizes, tier counts, and what top and bottom promos scored. Data only. */
export function performanceBrainNote(input: {
  brandName: string;
  records: { title: string; cohort: string | null; tier: string | null; aiScore: number | null; percentile: number | null }[];
}): { title: string; body: string } {
  const cohorts = new Map<string, typeof input.records>();
  for (const record of input.records) {
    if (!record.cohort) continue;
    cohorts.set(record.cohort, [...(cohorts.get(record.cohort) ?? []), record]);
  }
  const lines = [`# Promo results: ${input.brandName}`, "", "Percentile tiers from real results, ranked within each promo type. Statistics, not grades.", ""];
  const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  for (const [cohort, records] of [...cohorts.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${cohort} (${records.length} with results)`);
    const tiers = new Map<string, number>();
    for (const record of records) if (record.tier) tiers.set(record.tier, (tiers.get(record.tier) ?? 0) + 1);
    if (tiers.size === 0) lines.push("- Too few promos to tier yet (8 needed).");
    for (const [tier, count] of tiers) lines.push(`- ${TIER_LABELS[tier as TierKey] ?? tier}: ${count}`);
    const top = records.filter((r) => r.percentile != null && r.percentile >= 0.75);
    const bottom = records.filter((r) => r.percentile != null && r.percentile < 0.25);
    const topScore = mean(top.map((r) => r.aiScore).filter((s): s is number => s != null));
    const bottomScore = mean(bottom.map((r) => r.aiScore).filter((s): s is number => s != null));
    if (topScore != null || bottomScore != null) {
      lines.push(`- Average copy score: top quarter ${topScore ?? "n/a"}, bottom quarter ${bottomScore ?? "n/a"}.`);
    }
    if (top.length) lines.push(`- Top performers: ${top.slice(0, 8).map((r) => r.title).join("; ")}`);
    lines.push("");
  }
  return { title: `Promo results: ${input.brandName}`, body: lines.join("\n").trim() };
}
