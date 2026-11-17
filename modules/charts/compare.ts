/**
 * Compare lines: several series on one axis. Pure. Every line is aligned to the main line's dates and
 * rebased from its own first value, so the lines can be read against each other. Gains for each line
 * come from that line's own closes (tokens.ts), never from the rebased values.
 */
import type { CompareMode } from "./spec";
import { computeStats, type ChartBar, type SeriesStats } from "./tokens";

export type CompareInput = { symbol: string; label: string; color: string; bars: readonly ChartBar[] };

export type CompareLineDrawn = {
  symbol: string;
  label: string;
  color: string;
  /** One value per main bar (null before the line has data), already rebased. */
  values: Array<number | null>;
  /** Stats from the line's own closes over the main line's date range. */
  stats: SeriesStats | null;
};

/**
 * The other series' close at each main bar: the last close at or before that time (so a holiday on one
 * exchange carries the previous close forward). null until the other series has started.
 */
export function alignToMain(main: readonly ChartBar[], other: readonly ChartBar[]): Array<number | null> {
  const sorted = [...other].sort((a, b) => a.t - b.t);
  const out: Array<number | null> = [];
  let j = -1;
  for (const bar of main) {
    while (j + 1 < sorted.length && (sorted[j + 1] as ChartBar).t <= bar.t) j += 1;
    out.push(j >= 0 ? (sorted[j] as ChartBar).c : null);
  }
  return out;
}

/** The first positive value, which every point is measured against. */
export function baseOf(values: ReadonlyArray<number | null>): number | null {
  for (const value of values) if (value != null && value > 0) return value;
  return null;
}

/** rebase: base → 100. pct: base → 0 (% change). */
export function rebaseValue(value: number, base: number, mode: CompareMode): number {
  return mode === "rebase" ? (value / base) * 100 : (value / base - 1) * 100;
}

export function rebaseValues(values: ReadonlyArray<number | null>, mode: CompareMode): Array<number | null> {
  const base = baseOf(values);
  if (base == null) return values.map(() => null);
  return values.map((value) => (value == null ? null : rebaseValue(value, base, mode)));
}

/** The main bars rebased from their first close (o/h/l/c alike), so dots and callouts land on the line. */
export function rebaseBars(bars: readonly ChartBar[], mode: CompareMode): ChartBar[] {
  const base = baseOf(bars.map((bar) => bar.c));
  if (base == null) return [...bars];
  const f = (value: number) => rebaseValue(value, base, mode);
  return bars.map((bar) => ({ t: bar.t, o: f(bar.o), h: f(bar.h), l: f(bar.l), c: f(bar.c) }));
}

/** Clip a compare series to the main line's date range before computing its stats. */
function clipped(main: readonly ChartBar[], other: readonly ChartBar[]): ChartBar[] {
  if (main.length < 2) return [];
  const start = (main[0] as ChartBar).t;
  const end = (main[main.length - 1] as ChartBar).t;
  // Start at the last bar at or before the main start, so both lines measure the same window.
  const sorted = [...other].sort((a, b) => a.t - b.t);
  let first = sorted.findIndex((bar) => bar.t > start);
  first = first <= 0 ? 0 : first - 1;
  return sorted.slice(first).filter((bar) => bar.t <= end);
}

export function compareLines(main: readonly ChartBar[], inputs: readonly CompareInput[], mode: CompareMode): CompareLineDrawn[] {
  return inputs.map((input) => ({
    symbol: input.symbol,
    label: input.label || input.symbol,
    color: input.color,
    values: rebaseValues(alignToMain(main, input.bars), mode),
    stats: computeStats(clipped(main, input.bars)),
  }));
}

/** Tick label for a rebased axis: "+25%" / "-10%" / "0%" in pct mode, "125" in rebase mode. */
export function compareTick(value: number, step: number, mode: CompareMode): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  const v = Math.abs(value) < 1e-9 ? 0 : value;
  const text = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (mode === "rebase") return `${v < 0 ? "-" : ""}${text}`;
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${text}%`;
}
