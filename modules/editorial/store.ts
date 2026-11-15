export type IssueStatus = "draft" | "scheduled" | "sent";

export type EditorialIssue = {
  id: string;
  organizationId: string;
  title: string;
  subject: string;
  status: IssueStatus;
  body: string;
  scheduledFor: string | null;
  sentAt: string | null;
  opens: number;
  clicks: number;
  revenue: number;
};

type ExampleTemplate = Omit<EditorialIssue, "organizationId">;

// EXAMPLE seed rows. TODO: replace opens, clicks, and revenue with an ESP sync per issue and organization.
const EXAMPLE_TEMPLATES: readonly ExampleTemplate[] = [
  {
    id: "example-monday-brief",
    title: "EXAMPLE: Monday market brief",
    subject: "EXAMPLE — What moved before the open",
    status: "sent",
    body: "EXAMPLE seed copy for a sent issue. These send stats are not from a live email service provider.",
    scheduledFor: null,
    sentAt: "2026-11-10T13:00:00.000Z",
    opens: 18420,
    clicks: 2104,
    revenue: 12840.5,
  },
  {
    id: "example-subscriber-qa",
    title: "EXAMPLE: Subscriber Q&A",
    subject: "EXAMPLE — Three questions from the inbox",
    status: "scheduled",
    body: "EXAMPLE seed copy for a scheduled issue. Opens, clicks, and revenue stay at zero until it sends.",
    scheduledFor: "2026-11-18T13:00:00.000Z",
    sentAt: null,
    opens: 0,
    clicks: 0,
    revenue: 0,
  },
  {
    id: "example-coverage-draft",
    title: "EXAMPLE: How we pick coverage",
    subject: "EXAMPLE — A draft for the writing desk",
    status: "draft",
    body: "EXAMPLE seed copy for a draft. Use the writing assist on this issue.",
    scheduledFor: null,
    sentAt: null,
    opens: 0,
    clicks: 0,
    revenue: 0,
  },
];

const ESP_SYNC_TODO =
  "TODO: sync opens, clicks, and revenue from the ESP for each issue and organization. EXAMPLE seed stats are still in use.";

const rows = new Map<string, EditorialIssue>();
const seededOrganizations = new Set<string>();

export function resetEditorialStore(): void {
  rows.clear();
  seededOrganizations.clear();
}

export function seedExampleIssues(organizationId: string): EditorialIssue[] {
  requireOrganizationId(organizationId);
  const issues = EXAMPLE_TEMPLATES.map((template) => stamp(organizationId, template));
  for (const issue of issues) rows.set(rowKey(issue.organizationId, issue.id), issue);
  seededOrganizations.add(organizationId);
  return issues.map(clone);
}

export function listIssues(organizationId: string): EditorialIssue[] {
  ensureExampleIssues(organizationId);
  return [...rows.values()]
    .filter((issue) => issue.organizationId === organizationId)
    .map(clone)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getIssue(organizationId: string, issueId: string): EditorialIssue | null {
  if (!organizationId || !issueId) return null;
  ensureExampleIssues(organizationId);
  const issue = rows.get(rowKey(organizationId, issueId));
  if (!issue || issue.organizationId !== organizationId) return null;
  return clone(issue);
}

export function syncSendStatsFromEsp(): { status: "todo"; reason: string } {
  return { status: "todo", reason: ESP_SYNC_TODO };
}

function ensureExampleIssues(organizationId: string): void {
  requireOrganizationId(organizationId);
  if (seededOrganizations.has(organizationId)) return;
  seedExampleIssues(organizationId);
}

function stamp(organizationId: string, template: ExampleTemplate): EditorialIssue {
  const issue: EditorialIssue = { ...template, organizationId };
  assertStats(issue);
  return issue;
}

function assertStats(issue: EditorialIssue): void {
  for (const key of ["opens", "clicks", "revenue"] as const) {
    const value = issue[key];
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number`);
  }
}

function requireOrganizationId(organizationId: string): void {
  if (!organizationId) throw new Error("organizationId is required");
}

function rowKey(organizationId: string, id: string): string {
  return `${organizationId}\0${id}`;
}

function clone(issue: EditorialIssue): EditorialIssue {
  return { ...issue };
}
