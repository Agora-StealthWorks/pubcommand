import { lookupExampleCalls } from "./calls";
import { extractEmailInsights } from "./extract";
import type { Competitor, HistoricalCall, IngestedEmail } from "./types";

export type IntelStore = {
  listCompetitors(organizationId: string): Competitor[];
  addCompetitor(input: { organizationId: string; name: string; domain: string }): Competitor;
  listEmails(organizationId: string): IngestedEmail[];
  ingestEmail(input: {
    organizationId: string;
    subject: string;
    from: string;
    receivedAt: string;
    body: string;
  }): IngestedEmail;
  lookupHistoricalCalls(organizationId: string, date: string): HistoricalCall[];
};

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function receivedAtIso(value: string): string {
  const text = value.trim();
  const parsed = Date.parse(text);
  if (!text || Number.isNaN(parsed)) throw new Error("receivedAt must be a valid date");
  return new Date(parsed).toISOString();
}

export function createIntelStore(): IntelStore {
  const competitors: Competitor[] = [];
  const emails: IngestedEmail[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => {
    sequence += 1;
    return `${prefix}_${sequence.toString(36)}`;
  };

  return {
    listCompetitors(organizationId) {
      const org = organizationId.trim();
      if (!org) return [];
      return competitors.filter((row) => row.organizationId === org).map((row) => ({ ...row }));
    },
    addCompetitor(input) {
      const row: Competitor = {
        id: nextId("cmp"),
        organizationId: requireText(input.organizationId, "organizationId"),
        name: requireText(input.name, "name"),
        domain: requireText(input.domain, "domain").toLowerCase(),
      };
      competitors.push(row);
      return { ...row };
    },
    listEmails(organizationId) {
      const org = organizationId.trim();
      if (!org) return [];
      return emails.filter((row) => row.organizationId === org).map((row) => ({ ...row }));
    },
    ingestEmail(input) {
      const extracted = extractEmailInsights(input.body);
      const row: IngestedEmail = {
        id: nextId("mail"),
        organizationId: requireText(input.organizationId, "organizationId"),
        subject: requireText(input.subject, "subject"),
        from: requireText(input.from, "from"),
        receivedAt: receivedAtIso(input.receivedAt),
        bodyExcerpt: extracted.excerpt,
      };
      emails.push(row);
      return { ...row };
    },
    lookupHistoricalCalls(organizationId, date) {
      return lookupExampleCalls(organizationId, date);
    },
  };
}

const SAMPLE_COMPETITORS = [
  { name: "Northwind Mutual", domain: "northwind.example" },
  { name: "Harbor & Pine", domain: "harborpine.example" },
] as const;

const SAMPLE_EMAIL = {
  subject: "Q3 rate sheet",
  from: "desk@northwind.example",
  receivedAt: "2026-09-15T14:30:00.000Z",
  body: "Northwind published sample fixed annuity rates for the third quarter. This record is stored for the organization. It was not scraped.",
} as const;

/** Fixture rows so a new organization has a list to read. Not scraped. */
export function seedExampleRecords(store: IntelStore, organizationId: string): void {
  for (const competitor of SAMPLE_COMPETITORS) {
    store.addCompetitor({ organizationId, name: competitor.name, domain: competitor.domain });
  }
  store.ingestEmail({ organizationId, ...SAMPLE_EMAIL });
}
