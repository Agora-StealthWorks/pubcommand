export const DAY_MS = 86_400_000;

export function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

export function utcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return isoDate(d.getTime());
}

export function addDays(iso: string, days: number): string {
  return isoDate(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS);
}

export const PERIODS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "20Y", "MAX"] as const;
export type Period = (typeof PERIODS)[number];

/** A period chip as a concrete from/to range ending `end` (default today, UTC). */
export function periodRange(period: string, end = isoDate(Date.now())): { from: string; to: string } {
  const d = new Date(`${end}T00:00:00Z`);
  const back = (years: number, months = 0) => {
    const x = new Date(d);
    x.setUTCFullYear(x.getUTCFullYear() - years, x.getUTCMonth() - months);
    return isoDate(x.getTime());
  };
  switch (period.toUpperCase()) {
    case "5D":
      return { from: addDays(end, -7), to: end };
    case "1M":
      return { from: back(0, 1), to: end };
    case "3M":
      return { from: back(0, 3), to: end };
    case "6M":
      return { from: back(0, 6), to: end };
    case "YTD":
      return { from: `${d.getUTCFullYear()}-01-01`, to: end };
    case "3Y":
      return { from: back(3), to: end };
    case "5Y":
      return { from: back(5), to: end };
    case "10Y":
      return { from: back(10), to: end };
    case "20Y":
      return { from: back(20), to: end };
    case "MAX":
      return { from: "1962-01-01", to: end };
    case "1Y":
    default:
      return { from: back(1), to: end };
  }
}
