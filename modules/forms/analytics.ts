/**
 * Per-question results, computed from stored responses. Driven by each
 * field type's `analytics` kind in the registry.
 */
import { OTHER_PREFIX, fieldSpec } from "./fields";
import type { FieldDef, ResponseRecord } from "./types";

export type Bucket = { label: string; count: number; pct: number };

export type FieldStats = {
  fieldId: string;
  label: string;
  type: string;
  answered: number;
  /** Responses that reached and could answer this question (skipped/hidden ones excluded where we know). */
  base: number;
} & (
  | { kind: "choice" | "multi"; buckets: Bucket[]; free: boolean }
  | { kind: "numeric"; mean: number | null; median: number | null; min: number | null; max: number | null; buckets: Bucket[]; nps: NpsScore | null }
  | { kind: "bool"; buckets: Bucket[] }
  | { kind: "text" | "file" }
  | { kind: "date"; earliest: string | null; latest: string | null }
);

export type NpsScore = { score: number; promoters: number; passives: number; detractors: number };

export type FormStats = {
  complete: number;
  partial: number;
  flagged: number;
  completionRate: number | null;
  medianSeconds: number | null;
  /** Partial responses by the last page they reached (1-based). */
  dropOff: { page: number; count: number }[];
  sources: Bucket[];
  fields: FieldStats[];
};

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function npsScore(values: number[]): NpsScore | null {
  if (!values.length) return null;
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  const passives = values.length - promoters - detractors;
  return { score: Math.round(((promoters - detractors) / values.length) * 100), promoters, passives, detractors };
}

function bucketize(counts: Map<string, number>, total: number, order?: string[]): Bucket[] {
  const keys = order ? [...order, ...[...counts.keys()].filter((key) => !order.includes(key))] : [...counts.keys()];
  const buckets = keys.map((label) => ({ label, count: counts.get(label) ?? 0, pct: pct(counts.get(label) ?? 0, total) }));
  return order ? buckets : buckets.sort((a, b) => b.count - a.count);
}

export function fieldStats(field: FieldDef, responses: readonly ResponseRecord[]): FieldStats | null {
  const spec = fieldSpec(field.type);
  if (!spec || spec.analytics === "none") return null;
  const values = responses.map((response) => response.answers[field.id]).filter((value) => value !== undefined && value !== null);
  const base = responses.length;
  const head = { fieldId: field.id, label: field.label, type: field.type, answered: values.length, base };
  const choiceLabels = (field.config.choices ?? []).map((choice) => choice.label);
  const labelOf = (id: string) =>
    id.startsWith(OTHER_PREFIX) ? "Other (written in)" : field.config.choices?.find((choice) => choice.id === id)?.label ?? "(removed option)";

  switch (spec.analytics) {
    case "choice": {
      const counts = new Map<string, number>();
      const free = !field.config.choices;
      for (const value of values) {
        const label = free ? String(value) : labelOf(String(value));
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return { ...head, kind: "choice", free, buckets: bucketize(counts, values.length, free ? undefined : choiceLabels).slice(0, free ? 15 : 100) };
    }
    case "multi": {
      const counts = new Map<string, number>();
      for (const value of values) for (const id of Array.isArray(value) ? value : []) counts.set(labelOf(String(id)), (counts.get(labelOf(String(id))) ?? 0) + 1);
      return { ...head, kind: "multi", free: false, buckets: bucketize(counts, values.length, choiceLabels) };
    }
    case "numeric": {
      const numbers = values.map(Number).filter(Number.isFinite);
      const integral = field.type !== "number";
      const counts = new Map<string, number>();
      if (integral) {
        const min = field.type === "nps" ? 0 : field.type === "rating" ? 1 : (field.config.min ?? 1);
        const max = field.type === "nps" ? 10 : (field.config.max ?? 5);
        for (let v = min; v <= max; v += 1) counts.set(String(v), 0);
        for (const n of numbers) counts.set(String(n), (counts.get(String(n)) ?? 0) + 1);
      }
      return {
        ...head,
        kind: "numeric",
        mean: round(numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null),
        median: round(median(numbers)),
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
        buckets: integral ? bucketize(counts, numbers.length, [...counts.keys()]) : [],
        nps: field.type === "nps" ? npsScore(numbers) : null,
      };
    }
    case "bool": {
      const yes = values.filter((value) => value === true).length;
      const no = values.length - yes;
      const [y, n] = field.type === "consent" ? ["Agreed", "Not agreed"] : ["Yes", "No"];
      return { ...head, kind: "bool", buckets: [{ label: y, count: yes, pct: pct(yes, values.length) }, { label: n, count: no, pct: pct(no, values.length) }] };
    }
    case "date": {
      const dates = values.map(String).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
      return { ...head, kind: "date", earliest: dates[0] ?? null, latest: dates.at(-1) ?? null };
    }
    case "text":
      return { ...head, kind: "text" };
    case "file":
      return { ...head, kind: "file" };
  }
}

/**
 * Whole-form figures. `responses` should be every response; flagged (spam)
 * and partial ones are counted but held out of the per-question figures.
 */
export function formStats(fields: readonly FieldDef[], responses: readonly ResponseRecord[]): FormStats {
  const flagged = responses.filter((response) => response.spamReason);
  const clean = responses.filter((response) => !response.spamReason);
  const complete = clean.filter((response) => response.status === "COMPLETE");
  const partial = clean.filter((response) => response.status === "PARTIAL");
  const durations = complete.map((response) => response.durationMs).filter((value): value is number => typeof value === "number" && value > 0);
  const drop = new Map<number, number>();
  for (const response of partial) drop.set(response.lastPageIndex + 1, (drop.get(response.lastPageIndex + 1) ?? 0) + 1);
  const sources = new Map<string, number>();
  for (const response of complete) {
    const source = response.utm?.utm_source;
    if (source) sources.set(source, (sources.get(source) ?? 0) + 1);
  }
  return {
    complete: complete.length,
    partial: partial.length,
    flagged: flagged.length,
    completionRate: complete.length + partial.length ? pct(complete.length, complete.length + partial.length) : null,
    medianSeconds: durations.length ? Math.round(median(durations)! / 1000) : null,
    dropOff: [...drop.entries()].sort((a, b) => a[0] - b[0]).map(([page, count]) => ({ page, count })),
    sources: bucketize(sources, complete.length).slice(0, 10),
    fields: fields.map((field) => fieldStats(field, complete)).filter((stats): stats is FieldStats => stats !== null),
  };
}
