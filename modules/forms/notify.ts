/**
 * New-response emails to the team, and the respondent's confirmation email.
 * Pure: builds subjects and bodies and decides what is due. Sending lives in
 * apps/web/src/features/forms/notify.ts.
 *
 * Privacy: answers go into a team email only when the author turned that on,
 * and the sender only includes them for recipients who hold forms.export.
 * Uploads and signatures are named, never attached. Spam-flagged responses
 * never trigger an email.
 */
import { answerText, capturesAnswer, fieldSpec, isEmptyValue } from "./fields";
import type { AnswerMap, FieldDef } from "./types";

export type NotifyMode = "off" | "each" | "digest";
export const NOTIFY_MODES: { value: NotifyMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "each", label: "One email per response" },
  { value: "digest", label: "Daily digest (about 8am New York time)" },
];
export const DIGEST_HOUR = 8;
export const DIGEST_ZONE = "America/New_York";
/** An "each" email that did not go out is retried by the job after this long. */
export const EACH_RETRY_AFTER_MS = 10 * 60 * 1000;
export const MAX_RECIPIENTS = 25;
const MAX_IN_DIGEST = 50;

export function asNotifyMode(value: unknown): NotifyMode {
  return value === "each" || value === "digest" ? value : "off";
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export type AnswerLine = { question: string; answer: string };

/** Plain question/answer lines for one response. Files are named only. */
export function answerLines(fields: readonly FieldDef[], answers: AnswerMap): AnswerLine[] {
  return fields
    .filter((field) => capturesAnswer(field.type) && field.type !== "hidden" && !isEmptyValue(answers[field.id]))
    .map((field) => {
      const text = answerText(field, answers[field.id]);
      const kind = fieldSpec(field.type)?.analytics;
      return { question: field.label || "Untitled", answer: kind === "file" ? `${text} (open it in PubCommand)` : text.slice(0, 2000) };
    });
}

export type NotifyItem = { completedAt: Date; lines: AnswerLine[] | null };

function when(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The team email: one response ("each") or several ("digest"). `lines` null means answers left out. */
export function teamEmail(input: { formTitle: string; brandName: string; resultsUrl: string; mode: "each" | "digest"; items: NotifyItem[] }): { subject: string; html: string; text: string } {
  const items = input.items.slice(0, MAX_IN_DIGEST);
  const extra = input.items.length - items.length;
  const count = input.items.length;
  const subject =
    input.mode === "each" ? `New response: ${input.formTitle}` : `${count} new response${count === 1 ? "" : "s"}: ${input.formTitle}`;
  const textParts = [`${input.brandName} · ${input.formTitle}`, input.mode === "each" ? "A new response came in." : `${count} new response${count === 1 ? "" : "s"} since the last digest.`, ""];
  const htmlParts = [
    `<p style="margin:0 0 4px;color:#5b6577;font-size:13px">${escape(input.brandName)}</p>`,
    `<h1 style="margin:0 0 12px;font-size:20px">${escape(input.formTitle)}</h1>`,
    `<p>${input.mode === "each" ? "A new response came in." : `${count} new response${count === 1 ? "" : "s"} since the last digest.`}</p>`,
  ];
  items.forEach((item, index) => {
    const heading = input.mode === "each" ? `Received ${when(item.completedAt)}` : `Response ${index + 1} · ${when(item.completedAt)}`;
    textParts.push(heading);
    htmlParts.push(`<h2 style="margin:16px 0 6px;font-size:15px">${escape(heading)}</h2>`);
    if (item.lines) {
      for (const line of item.lines) textParts.push(`${line.question}: ${line.answer}`);
      htmlParts.push(
        `<table style="border-collapse:collapse;width:100%;font-size:14px">${item.lines
          .map((line) => `<tr><td style="padding:4px 8px 4px 0;vertical-align:top;color:#5b6577;width:40%">${escape(line.question)}</td><td style="padding:4px 0;vertical-align:top">${escape(line.answer)}</td></tr>`)
          .join("")}</table>`,
      );
    }
    textParts.push("");
  });
  if (extra > 0) {
    textParts.push(`…and ${extra} more.`);
    htmlParts.push(`<p>…and ${extra} more.</p>`);
  }
  const anyHidden = items.some((item) => !item.lines);
  if (anyHidden) {
    const note = "Answers are not included in this email. Open the results to read them.";
    textParts.push(note);
    htmlParts.push(`<p style="color:#5b6577">${note}</p>`);
  }
  textParts.push(`Results: ${input.resultsUrl}`);
  htmlParts.push(`<p><a href="${escape(input.resultsUrl)}">Open the results</a></p>`);
  return { subject: subject.slice(0, 200), html: htmlParts.join("\n"), text: textParts.join("\n") };
}

/** The respondent's confirmation: author-written text only, never their answers. */
export function confirmationEmail(input: { formTitle: string; brandName: string; subject: string; body: string }): { subject: string; html: string; text: string } {
  const subject = (input.subject.trim() || `Thanks for your response: ${input.formTitle}`).slice(0, 200);
  const body = input.body.trim() || `Thank you for filling in "${input.formTitle}". We have your response.`;
  const html = [
    `<p style="margin:0 0 4px;color:#5b6577;font-size:13px">${escape(input.brandName)}</p>`,
    ...body.split(/\n{2,}/).map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, "<br>")}</p>`),
  ].join("\n");
  return { subject, html, text: `${body}\n\n${input.brandName}` };
}

/** The address a confirmation goes to: the chosen email field's stored answer, when it looks like one. */
export function confirmationAddress(fields: readonly FieldDef[], fieldId: string | null, answers: AnswerMap): string | null {
  if (!fieldId) return null;
  const field = fields.find((item) => item.id === fieldId && item.type === "email");
  const value = field ? answers[field.id] : undefined;
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254 ? value : null;
}

/** Midnight-relative hour and calendar day in a time zone (no dependency). */
function zoned(now: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/**
 * Is a daily digest due? Once per New York day, from DIGEST_HOUR on. A run
 * missed at 8am (server down) catches up at the next hourly run that day.
 */
export function digestDue(lastSentAt: Date | null, now: Date, timeZone = DIGEST_ZONE): boolean {
  const today = zoned(now, timeZone);
  if (today.hour < DIGEST_HOUR) return false;
  if (!lastSentAt) return true;
  const last = zoned(lastSentAt, timeZone);
  return last.day < today.day || (last.day === today.day && last.hour < DIGEST_HOUR);
}

export type PendingRow = { id: string; completedAt: Date | null; spamReason: string | null; notifiedAt: Date | null; status: string };

/**
 * Which responses a notification run should cover for one form.
 *  - off: none (and nothing is marked, so turning it on later does not flood).
 *  - each: complete, unflagged, not yet notified, and older than the retry
 *    delay (the submit route sends the first attempt itself).
 *  - digest: every complete, unflagged, not-yet-notified response, when due.
 */
export function pendingNotifications(input: { mode: NotifyMode; recipients: number; lastDigestAt: Date | null; now: Date; rows: readonly PendingRow[] }): string[] {
  if (input.mode === "off" || input.recipients === 0) return [];
  const eligible = input.rows.filter((row) => row.status === "COMPLETE" && !row.spamReason && !row.notifiedAt && row.completedAt);
  if (input.mode === "each") return eligible.filter((row) => input.now.getTime() - row.completedAt!.getTime() >= EACH_RETRY_AFTER_MS).map((row) => row.id);
  return digestDue(input.lastDigestAt, input.now) ? eligible.map((row) => row.id) : [];
}
