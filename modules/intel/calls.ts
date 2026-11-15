import type { HistoricalCall } from "./types";

const EXAMPLE_CALLS = [
  {
    occurredOn: "2026-03-12",
    slug: "northwind-q1",
    title: "Northwind Q1 earnings call",
    summary: "Example row. No transcript was downloaded.",
  },
  {
    occurredOn: "2026-06-04",
    slug: "harbor-briefing",
    title: "Harbor & Pine product briefing",
    summary: "Example row. No recording was fetched.",
  },
] as const;

export const EXAMPLE_CALL_DATES: readonly string[] = EXAMPLE_CALLS.map((row) => row.occurredOn);

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Historical-call lookup. Matches the date against a fixed example catalog and stamps
 * the caller's organizationId. It does not scrape or request a transcript.
 */
export function lookupExampleCalls(organizationId: string, date: string): HistoricalCall[] {
  const org = organizationId.trim();
  const day = date.trim();
  if (!org || !isCalendarDate(day)) return [];
  return EXAMPLE_CALLS.filter((row) => row.occurredOn === day).map((row) => ({
    id: `example_${org}_${row.occurredOn}_${row.slug}`,
    organizationId: org,
    occurredOn: row.occurredOn,
    title: row.title,
    summary: row.summary,
    example: true as const,
  }));
}
