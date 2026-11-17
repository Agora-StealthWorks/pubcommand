/**
 * Per-brand dropdown options. Each field has built-in defaults; once a brand
 * saves its own list for a field, that list replaces the defaults. A value an
 * existing record already has is always kept, so removing an option never
 * silently rewrites old rows.
 */
import { EVENT_FORMATS, EVENT_STAGES, EVENT_TYPES, ISSUE_STATUSES, ISSUE_TYPES } from "./stages";

export const PROMO_STAGES = ["Idea", "Committed", "Copy platform", "Writing", "CUB", "Legal", "Production", "Complete", "Tabled", "Cancelled"] as const;
/** Promo stages that mean the promo is finished or parked; the CUB picker hides them. */
export const CLOSED_PROMO_STAGES = ["Complete", "Tabled", "Cancelled"];

export const OPTION_FIELDS = [
  { key: "event.stage", label: "Event stages", defaults: EVENT_STAGES, strict: true },
  { key: "event.type", label: "Event types", defaults: EVENT_TYPES, strict: false },
  { key: "event.format", label: "Event formats", defaults: EVENT_FORMATS, strict: false },
  { key: "issue.status", label: "Issue statuses", defaults: ISSUE_STATUSES, strict: true },
  { key: "issue.type", label: "Issue types", defaults: ISSUE_TYPES, strict: false },
  { key: "promo.stage", label: "Promo pipeline stages", defaults: PROMO_STAGES, strict: true },
] as const;

export type OptionField = (typeof OPTION_FIELDS)[number]["key"];
export type OptionLists = Record<OptionField, string[]>;

export function isOptionField(value: unknown): value is OptionField {
  return typeof value === "string" && OPTION_FIELDS.some((f) => f.key === value);
}

/** Saved rows → the list for every field (defaults where a field has no rows). */
export function resolveOptions(rows: { field: string; value: string; sortOrder: number }[]): OptionLists {
  const out = {} as OptionLists;
  for (const f of OPTION_FIELDS) {
    const own = rows
      .filter((r) => r.field === f.key)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((r) => r.value);
    out[f.key] = own.length ? own : [...f.defaults];
  }
  return out;
}

/** A clean option value: trimmed, single spaces, at most 60 characters. */
export function cleanOption(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * The value to store for a field. Strict fields (stages, statuses) only take a
 * listed value or the record's current one; free fields take anything typed.
 */
export function acceptOption(field: OptionField, value: string, options: OptionLists, current: string | null, fallback: string): string {
  const v = cleanOption(value);
  const strict = OPTION_FIELDS.find((f) => f.key === field)!.strict;
  if (!v) return strict ? (current ?? fallback) : "";
  if (!strict) return v;
  if (options[field].includes(v) || v === current) return v;
  return current ?? fallback;
}

/** Options shown in a dropdown: the list, plus the record's current value if it is no longer listed. */
export function optionsWith(list: string[], current: string | null | undefined): string[] {
  return current && !list.includes(current) ? [...list, current] : list;
}

/** New order after moving one value up (-1) or down (+1). */
export function moveOption(list: string[], value: string, direction: -1 | 1): string[] {
  const i = list.indexOf(value);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export type PipelinePromo = { id: string; stage: string | null };

/** Promos grouped into the brand's stage columns, in order; unknown stages land in "Other". */
export function pipelineColumns<T extends PipelinePromo>(promos: T[], stages: string[]): { stage: string; promos: T[] }[] {
  const columns = stages.map((stage) => ({ stage, promos: [] as T[] }));
  const other: T[] = [];
  for (const p of promos) {
    const col = columns.find((c) => c.stage === (p.stage ?? stages[0]));
    if (col) col.promos.push(p);
    else other.push(p);
  }
  return other.length ? [...columns, { stage: "Other", promos: other }] : columns;
}

export function isOpenPromoStage(stage: string | null | undefined): boolean {
  return !CLOSED_PROMO_STAGES.includes(stage ?? "");
}
