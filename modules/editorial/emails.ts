/**
 * CUB Collector emails: the four template kinds, their merge fields, and when
 * the scheduled job sends the reminder and the "revisions ready" email.
 *
 * Templates are plain text with {{token}} merge fields. Every send is merged
 * on the server, so an edited subject or body still gets {{reviewLink}} filled in.
 */
import { addDays, weekday } from "./dates";
import { toZonedInput, zonedToUtc } from "./cub";

export const CUB_EMAIL_KINDS = ["cub-request", "cub-reminder", "cub-owner-confirm", "cub-complete"] as const;
export type CubEmailKind = (typeof CUB_EMAIL_KINDS)[number];

export type MergeField = { token: string; label: string };

export type TemplateSpec = {
  label: string;
  description: string;
  subject: string;
  body: string;
  mergeFields: MergeField[];
  /** Only the request template keeps a saved reviewer group; the others go to a known person. */
  hasRecipientGroup: boolean;
};

const REVIEWER_FIELDS: MergeField[] = [
  { token: "promoName", label: "Promo" },
  { token: "brandName", label: "Brand" },
  { token: "initiatorName", label: "Who started the round" },
  { token: "deadline", label: "Deadline (Eastern)" },
  { token: "reviewLink", label: "Reviewer link" },
  { token: "instructions", label: "Note to reviewers" },
];

export const TEMPLATES: Record<CubEmailKind, TemplateSpec> = {
  "cub-request": {
    label: "Review request (to reviewers)",
    description: "Sent to the reviewer group when a round starts. The draft is attached.",
    subject: "Please review: {{promoName}} (due {{deadline}})",
    body: [
      "Hi,",
      "",
      "{{initiatorName}} would like your review of the near-final draft of {{promoName}}.",
      "",
      "{{instructions}}",
      "",
      "The draft is attached. Mark it up, then upload your copy and four quick scores here:",
      "{{reviewLink}}",
      "",
      "Please send it by {{deadline}}. Your scores are anonymous; your name goes on your marked-up file.",
    ].join("\n"),
    mergeFields: REVIEWER_FIELDS,
    hasRecipientGroup: true,
  },
  "cub-reminder": {
    label: "Reminder (to reviewers)",
    description: "Sent to the same reviewers at 9:05 am Eastern on the business day before the deadline.",
    subject: "Reminder: {{promoName}} review is due {{deadline}}",
    body: [
      "Hi,",
      "",
      "A reminder that the review of {{promoName}} is due {{deadline}}.",
      "",
      "If you have not sent yours yet, upload your marked-up copy and scores here:",
      "{{reviewLink}}",
      "",
      "The draft is attached again.",
    ].join("\n"),
    mergeFields: REVIEWER_FIELDS,
    hasRecipientGroup: false,
  },
  "cub-owner-confirm": {
    label: "Confirmation (to you)",
    description: "Sent to whoever started the round, with their private link to the revisions.",
    subject: "Your review round for {{promoName}} is out",
    body: [
      "Your review request for {{promoName}} went to {{reviewerCount}} reviewer(s).",
      "",
      "Deadline: {{deadline}}",
      "",
      "Follow the revisions and download them here (no sign-in needed):",
      "{{ownerLink}}",
      "",
      "We will email you again when the deadline passes.",
    ].join("\n"),
    mergeFields: [
      { token: "promoName", label: "Promo" },
      { token: "deadline", label: "Deadline (Eastern)" },
      { token: "reviewerCount", label: "Number of reviewers" },
      { token: "ownerLink", label: "Owner link" },
    ],
    hasRecipientGroup: false,
  },
  "cub-complete": {
    label: "Revisions ready (to you)",
    description: "Sent to whoever started the round once the deadline has passed.",
    subject: "Revisions ready: {{promoName}}",
    body: [
      "The deadline for {{promoName}} has passed and {{submissionCount}} revision(s) came in.",
      "",
      "Download them one by one or all at once:",
      "{{ownerLink}}",
      "",
      "Late revisions are still accepted, so check back if you are waiting on someone.",
    ].join("\n"),
    mergeFields: [
      { token: "promoName", label: "Promo" },
      { token: "submissionCount", label: "Revisions received" },
      { token: "ownerLink", label: "Owner link" },
    ],
    hasRecipientGroup: false,
  },
};

export function isCubEmailKind(value: unknown): value is CubEmailKind {
  return typeof value === "string" && (CUB_EMAIL_KINDS as readonly string[]).includes(value);
}

export type TemplateRow = { subject: string; body: string; recipients: string[]; enabled: boolean };

/** The template in effect: the saved row, or the built-in default. */
export function effectiveTemplate(kind: CubEmailKind, row: TemplateRow | null | undefined): TemplateRow {
  const spec = TEMPLATES[kind];
  return {
    subject: row?.subject?.trim() ? row.subject : spec.subject,
    body: row?.body?.trim() ? row.body : spec.body,
    recipients: row?.recipients ?? [],
    enabled: row?.enabled ?? true,
  };
}

/** Replace {{token}} with its value. Unknown tokens become empty; runs of 3+ blank lines collapse. */
export function renderMerge(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? "").replace(/\n{3,}/g, "\n\n");
}

export function cubMergeValues(v: {
  promoName: string;
  brandName?: string | null;
  initiatorName?: string | null;
  deadline?: string | null;
  reviewLink?: string | null;
  ownerLink?: string | null;
  instructions?: string | null;
  reviewerCount?: number | null;
  submissionCount?: number | null;
}): Record<string, string> {
  const s = (x: string | null | undefined) => (x ?? "").trim();
  return {
    promoName: s(v.promoName),
    brandName: s(v.brandName),
    initiatorName: s(v.initiatorName) || "A teammate",
    deadline: s(v.deadline),
    reviewLink: s(v.reviewLink),
    ownerLink: s(v.ownerLink),
    instructions: s(v.instructions),
    reviewerCount: v.reviewerCount == null ? "" : String(v.reviewerCount),
    submissionCount: v.submissionCount == null ? "" : String(v.submissionCount),
  };
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain-text email → simple HTML: escaped, links clickable, line breaks kept. */
export function textToHtml(text: string): string {
  const html = escape(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#101828">${html.replace(/\n/g, "<br>")}</div>`;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Split a typed list of addresses (commas, semicolons, new lines). Returns valid ones, de-duplicated, and the rest. */
export function parseEmails(text: string, max = 50): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,;\n\s]+/)) {
    const value = raw.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!value) continue;
    if (!EMAIL.test(value)) invalid.push(raw.trim());
    else if (!valid.includes(value)) valid.push(value);
  }
  return { valid: valid.slice(0, max), invalid };
}

const TZ = "America/New_York";

/** The previous business day (Mon-Fri) before a day. */
export function previousBusinessDay(day: string): string {
  let d = addDays(day, -1);
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

/** When the reminder goes out: 9:05 am Eastern on the business day before the deadline's day. */
export function reminderMoment(dueAt: Date, timeZone = TZ): Date {
  const dueDay = toZonedInput(dueAt, timeZone).slice(0, 10);
  return zonedToUtc(previousBusinessDay(dueDay), "09:05", timeZone);
}

export type TickRound = {
  id: string;
  createdAt: Date;
  dueAt: Date;
  closedAt: Date | null;
  /** Reminders go only to reviewers who were sent the request. */
  requestSentAt: Date | null;
  reminderSentAt: Date | null;
  deadlineNotifiedAt: Date | null;
};

export type TickPlan = {
  /** Send the reminder now. */
  remind: string[];
  /** Stamp without sending: the round started after the reminder moment, so a reminder minutes after the request is noise. */
  skipReminder: string[];
  /** Send "revisions ready" now. */
  complete: string[];
};

/**
 * What one job tick does. Idempotent through the stamp columns: a round with
 * reminderSentAt or deadlineNotifiedAt set is never picked again for that email.
 */
export function planCubTick(rounds: TickRound[], now: Date): TickPlan {
  const plan: TickPlan = { remind: [], skipReminder: [], complete: [] };
  for (const r of rounds) {
    if (!r.deadlineNotifiedAt && r.dueAt.getTime() <= now.getTime()) {
      plan.complete.push(r.id);
      continue;
    }
    if (r.reminderSentAt || r.closedAt || !r.requestSentAt || r.dueAt.getTime() <= now.getTime()) continue;
    const moment = reminderMoment(r.dueAt);
    if (now.getTime() < moment.getTime()) continue;
    if (r.createdAt.getTime() >= moment.getTime()) plan.skipReminder.push(r.id);
    else plan.remind.push(r.id);
  }
  return plan;
}

/** Attach the draft only up to this size; bigger drafts go by link only. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
