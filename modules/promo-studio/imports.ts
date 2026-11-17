/**
 * Performance import bookkeeping: undoing an import, manual tier overrides,
 * hand links, and the column mapping a sheet sync remembers by header name.
 * Pure functions only.
 */

import { PERFORMANCE_FIELDS, TIER_LABELS, type ColumnMapping, type PerformanceFieldKey, type TierKey } from "./performance";

// ── Undo ─────────────────────────────────────────────────────────────────────

/** The numbers an import writes onto a row; a snapshot keeps them so undo can put them back. */
export const SNAPSHOT_FIELDS = [
  "importId",
  "promoCode",
  "label",
  "sheetType",
  "startDate",
  "endDate",
  "sent",
  "views",
  "clicks",
  "orders",
  "revenue",
  "cost",
  "extra",
] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
export type RowSnapshot = { codeKey: string; data: Partial<Record<SnapshotField, unknown>> };

/** Copy the import-owned fields of a row (dates as ISO strings so the snapshot is plain JSON). */
export function snapshotRow(row: { codeKey: string } & Partial<Record<SnapshotField, unknown>>): RowSnapshot {
  const data: Partial<Record<SnapshotField, unknown>> = {};
  for (const key of SNAPSHOT_FIELDS) {
    const value = row[key];
    data[key] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  return { codeKey: row.codeKey, data };
}

/** Turn a stored snapshot back into update data (dates revived). */
export function restoreData(snapshot: RowSnapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_FIELDS) {
    if (!(key in snapshot.data)) continue;
    const value = snapshot.data[key];
    out[key] = (key === "startDate" || key === "endDate") && typeof value === "string" ? new Date(value) : value;
  }
  return out;
}

export function parseSnapshots(raw: unknown): RowSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { codeKey, data } = item as { codeKey?: unknown; data?: unknown };
    if (typeof codeKey !== "string" || !data || typeof data !== "object") return [];
    return [{ codeKey, data: data as RowSnapshot["data"] }];
  });
}

export type UndoPlan = {
  /** Rows this import created: deleted. */
  remove: string[];
  /** Rows this import replaced: put back as they were. */
  restore: RowSnapshot[];
  /** Codes a later import has changed since; left alone so newer numbers are not lost. */
  kept: string[];
};

/**
 * What undoing one import does. Only rows still carrying this import's id are
 * touched; anything a later import overwrote keeps the newer numbers.
 */
export function planUndo(input: {
  importId: string;
  createdCodes: readonly string[];
  previous: readonly RowSnapshot[];
  current: readonly { codeKey: string; importId: string | null }[];
}): UndoPlan {
  const owner = new Map(input.current.map((row) => [row.codeKey, row.importId]));
  const plan: UndoPlan = { remove: [], restore: [], kept: [] };
  const seen = new Set<string>();
  for (const code of input.createdCodes) {
    if (seen.has(code) || !owner.has(code)) continue;
    seen.add(code);
    if (owner.get(code) === input.importId) plan.remove.push(code);
    else plan.kept.push(code);
  }
  for (const snapshot of input.previous) {
    if (seen.has(snapshot.codeKey) || !owner.has(snapshot.codeKey)) continue;
    seen.add(snapshot.codeKey);
    if (owner.get(snapshot.codeKey) === input.importId) plan.restore.push(snapshot);
    else plan.kept.push(snapshot.codeKey);
  }
  return plan;
}

// ── Tier overrides ───────────────────────────────────────────────────────────

export const TIER_KEYS = Object.keys(TIER_LABELS) as TierKey[];
/** "none" is an override too: show no tier for this code (e.g. a test send). */
export type TierOverride = TierKey | "none";

export function parseTierOverride(value: string): TierOverride | null {
  if (value === "none") return "none";
  return (TIER_KEYS as readonly string[]).includes(value) ? (value as TierKey) : null;
}

/** The tier everyone sees: a person's override wins over the data. */
export function effectiveTier(computed: string | null, override: string | null): string | null {
  if (!override) return computed;
  return override === "none" ? null : override;
}

/** A representative percentile for an overridden tier, so the 1-10 real-world score follows the override. */
const TIER_MIDPOINT: Record<TierKey, number> = {
  top10: 0.95,
  upper: 0.775,
  middle: 0.475,
  lower: 0.2,
  bottom10: 0.05,
  top25: 0.875,
  middle50: 0.5,
  bottom25: 0.125,
};

export function overridePercentile(override: string | null, computed: number | null): number | null {
  if (!override) return computed;
  if (override === "none") return null;
  return TIER_MIDPOINT[override as TierKey] ?? computed;
}

/** A reason is required so the next person knows why the data was overruled. */
export function overrideProblem(input: { tier: string; reason: string }): string | null {
  if (!input.tier) return null;
  if (!parseTierOverride(input.tier)) return "Pick a tier.";
  if (input.reason.trim().length < 5) return "Say why you are overriding the data (a few words at least).";
  return null;
}

// ── Mapping by header name (sheet sync) ──────────────────────────────────────

export type HeaderMapping = Partial<Record<PerformanceFieldKey, string>>;

const headerKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Remember a mapping by header text, so a sheet whose columns move still maps. */
export function mappingToHeaders(mapping: ColumnMapping, headers: readonly string[]): HeaderMapping {
  const out: HeaderMapping = {};
  for (const field of PERFORMANCE_FIELDS) {
    const index = mapping[field.key];
    if (index != null && index >= 0 && headers[index]) out[field.key] = headers[index]!;
  }
  return out;
}

/** Re-resolve a remembered mapping against today's headers. Missing headers map to -1. */
export function mappingFromHeaders(mapping: HeaderMapping, headers: readonly string[]): ColumnMapping {
  const index = new Map(headers.map((header, i) => [headerKey(header), i]));
  const out = {} as ColumnMapping;
  for (const field of PERFORMANCE_FIELDS) {
    const name = mapping[field.key];
    out[field.key] = name ? (index.get(headerKey(name)) ?? -1) : -1;
  }
  return out;
}

export function parseHeaderMapping(raw: unknown): HeaderMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: HeaderMapping = {};
  for (const field of PERFORMANCE_FIELDS) {
    const value = (raw as Record<string, unknown>)[field.key];
    if (typeof value === "string" && value.trim()) out[field.key] = value.trim().slice(0, 200);
  }
  return out;
}

// ── Table helpers ────────────────────────────────────────────────────────────

/** Write a table as CSV (RFC 4180 quoting). A synced sheet is stored this way so undo and re-import can read it. */
export function toCsv(table: readonly (readonly string[])[]): string {
  const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return table.map((row) => row.map((value) => cell(value ?? "")).join(",")).join("\r\n");
}
