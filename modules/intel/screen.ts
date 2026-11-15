import { EXAMPLE_CALL_DATES, isCalendarDate } from "./calls";
import { createIntelStore, seedExampleRecords, type IntelStore } from "./store";
import type { Competitor, HistoricalCall, IngestedEmail } from "./types";

export type IntelScreen = {
  title: string;
  description: string;
  organizationId: string;
  competitors: Competitor[];
  emails: IngestedEmail[];
  callDate: string;
  callMessage: string;
  calls: HistoricalCall[];
  exampleCallDates: readonly string[];
};

const sharedIntelStore = createIntelStore();
const seededOrganizations = new Set<string>();

export function loadIntelScreen(
  input: { organizationId: string; callDate?: string },
  store: IntelStore = sharedIntelStore,
): IntelScreen {
  const organizationId = input.organizationId.trim();
  if (!organizationId) throw new Error("organizationId is required");
  if (store === sharedIntelStore && !seededOrganizations.has(organizationId)) {
    seedExampleRecords(store, organizationId);
    seededOrganizations.add(organizationId);
  }

  const callDate = (input.callDate ?? "").trim();
  let callMessage = `Pick a date. Example rows exist for ${EXAMPLE_CALL_DATES.join(" and ")}.`;
  let calls: HistoricalCall[] = [];
  if (callDate && !isCalendarDate(callDate)) {
    callMessage = "Use a calendar date, YYYY-MM-DD.";
  } else if (callDate) {
    calls = store.lookupHistoricalCalls(organizationId, callDate);
    callMessage = calls.length
      ? "Example rows only. Nothing was fetched."
      : "No example call on this date.";
  }

  return {
    title: "Intel",
    description: "Competitors, ingested email excerpts, and example historical calls for this organization.",
    organizationId,
    competitors: store.listCompetitors(organizationId),
    emails: store.listEmails(organizationId),
    callDate,
    callMessage,
    calls,
    exampleCallDates: EXAMPLE_CALL_DATES,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rows(cells: string[][]): string {
  if (cells.length === 0) return "";
  return cells
    .map((row) => `<tr>${row.map((cell) => `<td class="px-4 py-3 align-top text-sm">${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
}

/** Light server-rendered markup for /intel. Records stay scoped to the screen's organization. */
export function renderIntelScreen(screen: IntelScreen): string {
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(screen.callDate) ? screen.callDate : "";
  const competitorRows = rows(screen.competitors.map((row) => [row.name, row.domain]));
  const emailRows = rows(screen.emails.map((row) => [row.subject, row.from, row.receivedAt, row.bodyExcerpt]));
  const callRows = rows(screen.calls.map((row) => ["Example", row.occurredOn, row.title, row.summary]));

  return `<div data-module="intel" data-organization="${escapeHtml(screen.organizationId)}">
<header class="mb-6">
<h1 class="text-2xl font-semibold tracking-tight text-ink">${escapeHtml(screen.title)}</h1>
<p class="mt-1 max-w-2xl text-sm text-muted">${escapeHtml(screen.description)}</p>
</header>
<section class="mb-6">
<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Competitors</h2>
<div class="pc-scroll"><table class="w-full min-w-[24rem] text-left">
<thead><tr><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Name</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Domain</th></tr></thead>
<tbody>${competitorRows || `<tr><td class="px-4 py-4 text-sm text-muted" colspan="2">No competitors for this organization.</td></tr>`}</tbody>
</table></div>
</section>
<section class="mb-6">
<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Ingested email</h2>
<div class="pc-scroll"><table class="w-full min-w-[36rem] text-left">
<thead><tr><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Subject</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">From</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Received</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Excerpt</th></tr></thead>
<tbody>${emailRows || `<tr><td class="px-4 py-4 text-sm text-muted" colspan="4">No ingested email for this organization.</td></tr>`}</tbody>
</table></div>
</section>
<section>
<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Historical calls</h2>
<form method="get" action="/intel" class="pc-form-row mb-4 max-w-md">
<label for="intel-call-date" class="text-sm font-semibold text-ink">Call date</label>
<input id="intel-call-date" name="date" type="date" value="${escapeHtml(dateValue)}" class="pc-control w-full">
<button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white">Look up</button>
</form>
<p class="mb-3 text-sm text-muted">${escapeHtml(screen.callMessage)}</p>
<div class="pc-scroll"><table class="w-full min-w-[36rem] text-left">
<thead><tr><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Source</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Date</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Title</th><th class="px-4 py-3 text-xs font-semibold uppercase text-muted">Summary</th></tr></thead>
<tbody>${callRows || `<tr><td class="px-4 py-4 text-sm text-muted" colspan="4">No call rows for this date.</td></tr>`}</tbody>
</table></div>
</section>
</div>`;
}
