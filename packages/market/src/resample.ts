import { DAY_MS } from "./dates";
import type { Bar, Interval } from "./types";

/** Daily bars → weekly (Monday-start) or monthly OHLC. Each bucket is stamped with its last day. */
export function resample(daily: readonly Bar[], interval: Interval): Bar[] {
  if (interval === "day" || daily.length === 0) return daily.map((bar) => ({ ...bar }));
  const bucket = (t: number) => {
    const d = new Date(t);
    if (interval === "month") return d.getUTCFullYear() * 12 + d.getUTCMonth();
    const mondayOffset = (d.getUTCDay() + 6) % 7;
    return Math.floor(t / DAY_MS) - mondayOffset;
  };
  const out: Bar[] = [];
  let current: Bar | null = null;
  let key = Number.NaN;
  for (const bar of daily) {
    const k = bucket(bar.t);
    if (current && k === key) {
      current.h = Math.max(current.h, bar.h);
      current.l = Math.min(current.l, bar.l);
      current.c = bar.c;
      current.t = bar.t;
      if (bar.v != null) current.v = (current.v ?? 0) + bar.v;
    } else {
      if (current) out.push(current);
      current = { ...bar };
      key = k;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Divide A by B on the days both have a close. */
export function ratioBars(a: readonly Bar[], b: readonly Bar[]): Bar[] {
  const byDay = new Map(b.map((bar) => [Math.floor(bar.t / DAY_MS), bar]));
  const out: Bar[] = [];
  for (const bar of a) {
    const other = byDay.get(Math.floor(bar.t / DAY_MS));
    if (!other || !other.c) continue;
    const value = bar.c / other.c;
    out.push({ t: bar.t, o: value, h: value, l: value, c: value });
  }
  return out;
}
