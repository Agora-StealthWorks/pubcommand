/**
 * Send-stat rollups by week, month or quarter.
 *
 * Every rate is re-derived as a weighted ratio of sums (total opens ÷ total
 * mailed), so a big send outweighs a small one. Stored per-send percentages are
 * never averaged.
 */
import { addDays, weekday } from "./dates";

export type Grain = "week" | "month" | "quarter";
export const GRAINS: Grain[] = ["week", "month", "quarter"];

export type StatInput = {
  mailDate: string | null;
  pubCode: string;
  delivered: number | null;
  openRate: number | null;
  clickRate: number | null;
  revenue: number | null;
  totalOpened: number | null;
  totalClicked: number | null;
  unsubscribes: number | null;
};

/** One send's counts. Rates become counts (ratio × mailed) so they can be summed. */
export type SendRow = { day: string; pub: string; sends: number; mailed: number; opens: number; clicks: number; revenue: number; unsubs: number };

/**
 * The count behind a rate. The rate × mailed is preferred; the raw total is a
 * fallback when no rate was given (ESP "total" columns often count repeat
 * opens, which would overstate the rate).
 */
export function countFrom(rate: number | null, mailed: number | null, total: number | null): number {
  if (rate != null && mailed != null) return Math.round(rate * mailed);
  return total ?? 0;
}

export function toSendRow(s: StatInput): SendRow | null {
  if (!s.mailDate) return null;
  return {
    day: s.mailDate,
    pub: s.pubCode,
    sends: 1,
    mailed: s.delivered ?? 0,
    opens: countFrom(s.openRate, s.delivered, s.totalOpened),
    clicks: countFrom(s.clickRate, s.delivered, s.totalClicked),
    revenue: s.revenue ?? 0,
    unsubs: s.unsubscribes ?? 0,
  };
}

/** The bucket a day falls in: Monday-start week, "YYYY-MM", or "YYYY-Qn". */
export function bucketOf(day: string, grain: Grain): string {
  if (grain === "month") return day.slice(0, 7);
  if (grain === "quarter") return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
  return addDays(day, -((weekday(day) + 6) % 7));
}

export function bucketLabel(bucket: string, grain: Grain): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (grain === "quarter") return bucket.replace("-", " ");
  if (grain === "month") return `${months[Number(bucket.slice(5, 7)) - 1]} '${bucket.slice(2, 4)}`;
  return `${months[Number(bucket.slice(5, 7)) - 1]} ${Number(bucket.slice(8, 10))}`;
}

export type Rollup = {
  bucket: string;
  sends: number;
  mailed: number;
  opens: number;
  clicks: number;
  revenue: number;
  unsubs: number;
  openRate: number | null;
  clickRate: number | null;
  clickToOpen: number | null;
  revenuePerThousand: number | null;
  unsubRate: number | null;
};

export const STATS = [
  { key: "openRate", label: "Open rate", unit: "pct" },
  { key: "clickRate", label: "Click rate", unit: "pct" },
  { key: "clickToOpen", label: "Click-to-open", unit: "pct" },
  { key: "revenuePerThousand", label: "Revenue per 1,000 mailed", unit: "usd" },
  { key: "revenue", label: "Revenue", unit: "usd" },
  { key: "mailed", label: "Mailed", unit: "count" },
  { key: "sends", label: "Sends", unit: "count" },
  { key: "unsubRate", label: "Unsubscribe rate", unit: "pct" },
] as const;
export type StatKey = (typeof STATS)[number]["key"];

function finish(bucket: string, t: Omit<Rollup, "bucket" | "openRate" | "clickRate" | "clickToOpen" | "revenuePerThousand" | "unsubRate">): Rollup {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    bucket,
    ...t,
    openRate: ratio(t.opens, t.mailed),
    clickRate: ratio(t.clicks, t.mailed),
    clickToOpen: ratio(t.clicks, t.opens),
    revenuePerThousand: t.mailed > 0 ? (t.revenue / t.mailed) * 1000 : null,
    unsubRate: ratio(t.unsubs, t.mailed),
  };
}

/** Sum rows into buckets (sorted oldest first) and derive weighted rates. */
export function rollup(rows: SendRow[], grain: Grain, pubs: string[] = []): Rollup[] {
  const wanted = new Set(pubs);
  const sums = new Map<string, Omit<Rollup, "bucket" | "openRate" | "clickRate" | "clickToOpen" | "revenuePerThousand" | "unsubRate">>();
  for (const row of rows) {
    if (wanted.size && !wanted.has(row.pub)) continue;
    const key = bucketOf(row.day, grain);
    const t = sums.get(key) ?? { sends: 0, mailed: 0, opens: 0, clicks: 0, revenue: 0, unsubs: 0 };
    t.sends += row.sends;
    t.mailed += row.mailed;
    t.opens += row.opens;
    t.clicks += row.clicks;
    t.revenue += row.revenue;
    t.unsubs += row.unsubs;
    sums.set(key, t);
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, t]) => finish(bucket, t));
}

/** Keep the last `n` buckets (0 = all). */
export function lastPeriods<T>(list: T[], n: number): T[] {
  return n > 0 ? list.slice(-n) : list;
}

/** Whole-range totals with weighted rates. */
export function totals(rows: SendRow[], pubs: string[] = []): Rollup {
  const all = rollup(rows.map((r) => ({ ...r, day: "2000-01-01" })), "month", pubs)[0];
  return all ? { ...all, bucket: "all" } : finish("all", { sends: 0, mailed: 0, opens: 0, clicks: 0, revenue: 0, unsubs: 0 });
}

/**
 * Round tick values for an axis. With `fromZero` the axis starts at 0;
 * otherwise it zooms to the data but never goes below 0.
 */
export function niceTicks(values: number[], fromZero: boolean, count = 4): number[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let min = fromZero ? 0 : Math.min(...finite);
  let max = Math.max(...finite);
  if (max === min) {
    max = max === 0 ? 1 : max * 1.1;
    min = fromZero ? 0 : Math.max(0, min * 0.9);
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.max(0, Math.floor(min / step) * step);
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks.length < 2) ticks.push(start + step);
  return ticks;
}

export function formatStat(value: number | null, unit: "pct" | "usd" | "count"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "pct") return `${(value * 100).toFixed(value * 100 >= 10 ? 1 : 2)}%`;
  if (unit === "usd") return value >= 1000 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
  return Math.round(value).toLocaleString("en-US");
}
