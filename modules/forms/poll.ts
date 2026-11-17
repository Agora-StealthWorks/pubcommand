/**
 * Public live results ("poll mode"). This feeds a page anyone with the link
 * can open, so it is deliberately narrow:
 *
 *  - Only closed questions are tallied (choices, yes/no, scales, grids,
 *    rankings). Free text, contact fields, uploads, signatures and hidden/UTM
 *    values are never included: people type anything into those, including
 *    their own or someone else's details.
 *  - A written-in "Other" is counted as one "Other" bucket. Its text is never
 *    returned.
 *  - Nothing is per response: no ids, no times, no order.
 *  - Below `minResponses` (never less than POLL_MIN_FLOOR) the tally is
 *    withheld: a percentage of three people can identify who said what.
 *  - Spam-flagged and partial responses are left out.
 */
import { fieldStats, type Bucket } from "./analytics";
import { fieldSpec } from "./fields";
import type { FieldDef, ResponseRecord } from "./types";

export const POLL_MIN_FLOOR = 3;
const POLLABLE = new Set(["single_choice", "dropdown", "multi_choice", "yes_no", "rating", "scale", "nps", "slider", "matrix", "matrix_multi", "ranking"]);

export function isPollable(field: FieldDef): boolean {
  const spec = fieldSpec(field.type);
  return Boolean(spec && POLLABLE.has(field.type) && !spec.pii && spec.captures);
}

export type PollQuestion =
  | { fieldId: string; label: string; kind: "bars"; answered: number; buckets: Bucket[]; average: number | null }
  | { fieldId: string; label: string; kind: "grid"; answered: number; rows: { label: string; buckets: Bucket[] }[] }
  | { fieldId: string; label: string; kind: "ranking"; answered: number; items: { label: string; meanRank: number }[] };

export type PollResults =
  | { available: false; reason: "disabled" | "too_few"; total: number; minResponses: number }
  | { available: true; total: number; questions: PollQuestion[] };

export function effectiveMin(minResponses: number): number {
  return Math.max(POLL_MIN_FLOOR, Math.min(1000, Math.round(Number.isFinite(minResponses) ? minResponses : 5)));
}

/** "Other: typed text" becomes plain "Other" before anything is counted. */
function stripWriteIns(field: FieldDef, response: ResponseRecord): ResponseRecord {
  const value = response.answers[field.id];
  const clean = (item: unknown) => (typeof item === "string" && item.startsWith("other:") ? "other:x" : item);
  const next = Array.isArray(value) ? value.map(clean) : clean(value);
  return { ...response, answers: { [field.id]: next } };
}

export function pollResults(input: { enabled: boolean; minResponses: number; fields: readonly FieldDef[]; responses: readonly ResponseRecord[] }): PollResults {
  const min = effectiveMin(input.minResponses);
  const counted = input.responses.filter((response) => response.status === "COMPLETE" && !response.spamReason);
  if (!input.enabled) return { available: false, reason: "disabled", total: 0, minResponses: min };
  if (counted.length < min) return { available: false, reason: "too_few", total: counted.length, minResponses: min };
  const questions: PollQuestion[] = [];
  for (const field of input.fields) {
    if (!isPollable(field)) continue;
    const stats = fieldStats(field, counted.map((response) => stripWriteIns(field, response)));
    if (!stats) continue;
    const head = { fieldId: field.id, label: field.label, answered: stats.answered };
    if (stats.kind === "choice" || stats.kind === "multi" || stats.kind === "bool") {
      questions.push({ ...head, kind: "bars", buckets: stats.buckets, average: null });
    } else if (stats.kind === "numeric") {
      questions.push({ ...head, kind: "bars", buckets: stats.buckets, average: stats.mean });
    } else if (stats.kind === "matrix") {
      questions.push({ ...head, kind: "grid", rows: stats.rows.map((row) => ({ label: row.label, buckets: row.buckets })) });
    } else if (stats.kind === "ranking") {
      questions.push({ ...head, kind: "ranking", items: stats.items.map((item) => ({ label: item.label, meanRank: item.meanRank })) });
    }
  }
  return { available: true, total: counted.length, questions };
}
