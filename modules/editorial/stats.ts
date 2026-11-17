/**
 * ESP send-stats import: parse a CSV export, map its columns, and match each
 * row to an editorial issue.
 *
 * Match key: mail date + publication code. The subject line only breaks ties
 * between issues of the same publication on the same day. When two rows land
 * on one issue, the better subject match wins, then the bigger send.
 *
 * Rates are stored as ratios (0.0423 = 4.23%).
 */

export const STAT_FIELDS = [
  { key: "mailDate", label: "Mail date", required: true, aliases: ["day(mail date)", "mail date", "send date", "date", "sent", "sent at", "send time"] },
  { key: "list", label: "Publication / list", required: true, aliases: ["mailing e-list", "e-list", "elist", "list", "list name", "publication", "audience", "segment"] },
  { key: "subject", label: "Subject line", required: false, aliases: ["mailing subject", "subject", "subject line", "email subject"] },
  { key: "delivered", label: "Mailed / delivered", required: false, aliases: ["mailed", "delivered", "sends", "sent count", "total delivered", "recipients"] },
  { key: "openRate", label: "Open rate", required: false, aliases: ["opened %", "open rate", "opens %", "open %", "unique open rate"] },
  { key: "clickRate", label: "Click rate (of delivered)", required: false, aliases: ["clicked % (delivered)", "click rate", "clicks %", "ctr", "unique click rate"] },
  { key: "clickToOpen", label: "Click-to-open rate", required: false, aliases: ["clicked % (clicks/opens)", "ctor", "click to open rate", "click-to-open"] },
  { key: "revenue", label: "Revenue", required: false, aliases: ["total gross revenue", "revenue", "gross revenue", "sales"] },
  { key: "totalOpened", label: "Unique opens", required: false, aliases: ["unique opens", "total opened", "opens", "opened"] },
  { key: "totalClicked", label: "Unique clicks", required: false, aliases: ["unique clicks", "total clicked (link)", "total clicked", "clicks", "clicked"] },
  { key: "unsubscribes", label: "Unsubscribes", required: false, aliases: ["total removes", "unsubscribes", "unsubs", "removes", "opt outs"] },
  { key: "complaints", label: "Spam complaints", required: false, aliases: ["total spam complaint", "spam complaints", "complaints"] },
] as const;

export type StatFieldKey = (typeof STAT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<StatFieldKey, number>>;
export type RateFormat = "percent" | "ratio";

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. Blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9%()/]+/g, " ").trim();

/** Best guess of which column holds each field, from the header names. */
export function guessMapping(header: string[]): ColumnMapping {
  const normalized = header.map(norm);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of STAT_FIELDS) {
    const index = field.aliases.map((alias) => normalized.findIndex((h, i) => !used.has(i) && h === norm(alias))).find((i) => i >= 0);
    if (index != null && index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping): string[] {
  return STAT_FIELDS.filter((f) => f.required && mapping[f.key] == null).map((f) => f.label);
}

export function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A rate as a ratio. "4.23%" is always 0.0423. A bare number follows the
 * import's format: "percent" reads 4.23 as 4.23%, "ratio" reads it as 423%.
 */
export function parseRate(value: string | undefined, format: RateFormat): number | null {
  const n = parseNumber(value);
  if (n == null) return null;
  if ((value ?? "").includes("%") || format === "percent") return n / 100;
  return n;
}

/** Accepts 2026-11-07, 11/07/2026, 11/7/26, and a timestamp that starts with either. */
export function parseMailDate(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(v);
    if (!m) return null;
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  }
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "WAR - The Weekly Report" → "WAR"; "Morning Brief" → "MORNING". Upper-cased. */
export function ripCode(list: string | undefined): string | null {
  const v = (list ?? "").trim();
  if (!v) return null;
  const bracket = /^\[([A-Za-z0-9_-]+)\]/.exec(v);
  if (bracket) return bracket[1]!.toUpperCase();
  const dash = /^([A-Za-z0-9_]+)\s*[-–|:]\s*/.exec(v);
  return (dash ? dash[1]! : v.split(/\s+/)[0]!).toUpperCase();
}

export type ParsedStatRow = {
  line: number;
  mailDate: string | null;
  list: string;
  subject: string;
  delivered: number | null;
  openRate: number | null;
  clickRate: number | null;
  clickToOpen: number | null;
  revenue: number | null;
  totalOpened: number | null;
  totalClicked: number | null;
  unsubscribes: number | null;
  complaints: number | null;
};

export function parseStatRows(rows: string[][], mapping: ColumnMapping, format: RateFormat): ParsedStatRow[] {
  const cell = (row: string[], key: StatFieldKey) => (mapping[key] == null ? undefined : row[mapping[key]!]);
  const int = (row: string[], key: StatFieldKey) => {
    const n = parseNumber(cell(row, key));
    return n == null ? null : Math.round(n);
  };
  return rows.slice(1).map((row, i) => ({
    line: i + 2,
    mailDate: parseMailDate(cell(row, "mailDate")),
    list: (cell(row, "list") ?? "").trim(),
    subject: (cell(row, "subject") ?? "").trim(),
    delivered: int(row, "delivered"),
    openRate: parseRate(cell(row, "openRate"), format),
    clickRate: parseRate(cell(row, "clickRate"), format),
    clickToOpen: parseRate(cell(row, "clickToOpen"), format),
    revenue: parseNumber(cell(row, "revenue")),
    totalOpened: int(row, "totalOpened"),
    totalClicked: int(row, "totalClicked"),
    unsubscribes: int(row, "unsubscribes"),
    complaints: int(row, "complaints"),
  }));
}

const normSubject = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 2 = same subject, 1 = one contains the other, 0 = no useful overlap. */
export function subjectScore(subject: string, candidates: string[]): number {
  const a = normSubject(subject);
  if (!a) return 0;
  let best = 0;
  for (const candidate of candidates) {
    const b = normSubject(candidate);
    if (!b) continue;
    if (a === b) return 2;
    if (a.includes(b) || b.includes(a)) best = 1;
  }
  return best;
}

export type MatchableIssue = { id: string; publicationCode: string; mailDate: string | null; title: string; subjectLines: string[] };
export type Publication = { code: string; name: string };

/**
 * Publication codes a list label could mean: the ripped code, plus any
 * publication whose code or name the label equals or starts with.
 */
export function candidateCodes(list: string, publications: Publication[]): string[] {
  const out: string[] = [];
  const add = (code: string | null | undefined) => {
    if (code && !out.includes(code)) out.push(code);
  };
  const ripped = ripCode(list);
  const label = list.trim().toLowerCase();
  for (const p of publications) if (p.code.toUpperCase() === ripped) add(p.code);
  for (const p of publications) {
    const name = p.name.trim().toLowerCase();
    if (name && (label === name || label.endsWith(`- ${name}`) || label.startsWith(name))) add(p.code);
  }
  add(ripped);
  return out;
}

export type UnmatchedRow = { line: number; mailDate: string | null; list: string; subject: string; reason: string };
export type StatMatch = { issueId: string; pubCode: string; row: ParsedStatRow; subjectScore: number };

export function matchStats(rows: ParsedStatRow[], issues: MatchableIssue[], publications: Publication[]): { matches: StatMatch[]; unmatched: UnmatchedRow[] } {
  const index = new Map<string, MatchableIssue[]>();
  for (const issue of issues) {
    if (!issue.mailDate) continue;
    const key = `${issue.publicationCode.toUpperCase()}|${issue.mailDate}`;
    index.set(key, [...(index.get(key) ?? []), issue]);
  }
  const best = new Map<string, StatMatch>();
  const unmatched: UnmatchedRow[] = [];
  for (const row of rows) {
    const miss = (reason: string) => unmatched.push({ line: row.line, mailDate: row.mailDate, list: row.list, subject: row.subject, reason });
    if (!row.mailDate) {
      miss("No readable mail date");
      continue;
    }
    const codes = candidateCodes(row.list, publications);
    if (!codes.length) {
      miss("No publication");
      continue;
    }
    let code = codes[0]!;
    let found: MatchableIssue[] | undefined;
    for (const c of codes) {
      const list = index.get(`${c.toUpperCase()}|${row.mailDate}`);
      if (list?.length) {
        found = list;
        code = c;
        break;
      }
    }
    if (!found) {
      miss(publications.some((p) => codes.includes(p.code)) ? `No ${code} issue on that date` : `Unknown publication ${code}`);
      continue;
    }
    let pick = found[0]!;
    let score = subjectScore(row.subject, [...pick.subjectLines, pick.title]);
    for (const candidate of found.slice(1)) {
      const s = subjectScore(row.subject, [...candidate.subjectLines, candidate.title]);
      if (s > score) {
        pick = candidate;
        score = s;
      }
    }
    const previous = best.get(pick.id);
    if (!previous || score > previous.subjectScore || (score === previous.subjectScore && (row.delivered ?? 0) > (previous.row.delivered ?? 0))) {
      if (previous) unmatched.push({ line: previous.row.line, mailDate: previous.row.mailDate, list: previous.row.list, subject: previous.row.subject, reason: "Another row matched the same issue better" });
      best.set(pick.id, { issueId: pick.id, pubCode: code, row, subjectScore: score });
    } else {
      miss("Another row matched the same issue better");
    }
  }
  return { matches: [...best.values()], unmatched: unmatched.sort((a, b) => a.line - b.line) };
}
