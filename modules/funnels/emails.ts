/**
 * Invites and reminders. PURE (the job and the opt-in route do the sending).
 *
 * - A registration confirmation goes out once, right after someone opts in.
 * - A reminder goes out a set time before EACH session: every live day with a
 *   start time on a live funnel, or the funnel start on a fixed-date evergreen
 *   funnel. Per-viewer evergreen funnels have no shared start, so reminders
 *   never apply to them.
 * - Nobody who unsubscribed is emailed, and nobody gets a reminder for a moment
 *   that had already passed when they signed up ("starts in 24 hours" to
 *   someone who joined an hour before).
 * - Every send is keyed (email template, opt-in, session) so a retried job
 *   never sends twice.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { formatZoned } from "./time";

export const EMAIL_KINDS = ["confirm", "reminder"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const MERGE_TAGS = [
  { tag: "funnel", description: "The funnel name" },
  { tag: "company", description: "Your company name" },
  { tag: "email", description: "The subscriber's email address" },
  { tag: "session", description: "The session label, e.g. Day 2" },
  { tag: "session_title", description: "The session title" },
  { tag: "date", description: "Session date and time, e.g. Wednesday, November 11 at 2:00 PM EST" },
  { tag: "time", description: "Session time only, e.g. 2:00 PM EST" },
  { tag: "starts_in", description: "How long until it starts, e.g. 24 hours" },
  { tag: "link", description: "The page to open (the session, or the funnel)" },
  { tag: "room_url", description: "The livestream room link" },
  { tag: "unsubscribe_url", description: "One-click unsubscribe (added automatically if you leave it out)" },
] as const;
export type MergeTag = (typeof MERGE_TAGS)[number]["tag"];
export type MergeValues = Partial<Record<MergeTag, string>>;

const TAG_RE = /\{([a-z_]+)\}/g;
const KNOWN = new Set<string>(MERGE_TAGS.map((item) => item.tag));

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Replace {tags}. In "html" mode every value is HTML-escaped (a funnel name can
 * never inject markup). Unknown tags are left as typed so the author sees them;
 * known tags with no value become "".
 */
export function fillMergeTags(template: string, values: MergeValues, mode: "html" | "text"): string {
  return template.replace(TAG_RE, (whole, tag: string) => {
    if (!KNOWN.has(tag)) return whole;
    const value = values[tag as MergeTag] ?? "";
    return mode === "html" ? escapeHtmlText(value) : value;
  });
}

/** Tags in a template that are not merge tags (shown as a warning in the editor). */
export function unknownTags(template: string): string[] {
  return [...new Set([...template.matchAll(TAG_RE)].map((match) => match[1]!).filter((tag) => !KNOWN.has(tag)))];
}

/** "1 day before", "2 hours before", "15 minutes before", "At the start". */
export function describeOffset(minutes: number): string {
  if (minutes <= 0) return "At the start";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} before`;
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

/** "24 hours", "1 hour", "15 minutes", "a moment". For {starts_in}. */
export function startsIn(minutes: number): string {
  if (minutes < 1) return "a moment";
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Number + unit from the builder → minutes before (0 to 30 days). */
export function offsetFromInput(amount: unknown, unit: unknown): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const factor = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  return Math.min(30 * 1440, n * factor);
}

/** Minutes → the builder's number + unit. */
export function offsetToInput(minutes: number): { amount: number; unit: "minutes" | "hours" | "days" } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

export type ReminderSession = {
  /** A day id, or "start" for the funnel start. */
  key: string;
  label: string;
  title: string;
  startAt: Date;
  /** Path of the page to open, relative to the funnel ("/day-2" or ""). */
  path: string;
  roomUrl: string | null;
};

export type SessionFunnel = {
  mode: string;
  timing: string;
  startAt: Date | null;
  livestreamUrl: string | null;
  name: string;
};

export type SessionDay = {
  id: string;
  position: number;
  label: string;
  title: string;
  isLive: boolean;
  liveStartAt: Date | null;
  liveUrl: string | null;
  liveOverride: string;
};

/** The sessions reminders are timed against, earliest first. */
export function reminderSessions(funnel: SessionFunnel, days: SessionDay[]): ReminderSession[] {
  if (funnel.mode === "live") {
    return days
      .filter((day) => day.isLive && day.liveStartAt && day.liveOverride !== "off")
      .map((day) => ({ key: day.id, label: day.label, title: day.title, startAt: day.liveStartAt!, path: `/day-${day.position}`, roomUrl: day.liveUrl || funnel.livestreamUrl }))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }
  if (funnel.timing === "fixed" && funnel.startAt) return [{ key: "start", label: "The start", title: funnel.name, startAt: funnel.startAt, path: "", roomUrl: null }];
  return [];
}

/** Why a funnel has no reminder sessions, for the builder; null when it has some. */
export function noSessionsReason(funnel: SessionFunnel, sessions: ReminderSession[]): string | null {
  if (sessions.length) return null;
  if (funnel.mode === "live") return "No live day has a start time yet. Add start times on the Days tab.";
  if (funnel.timing !== "fixed") return "Per-viewer funnels start on each visitor's first visit, so there is no shared start to remind people of.";
  return "Set a start date on the Setup tab.";
}

export const MAX_LATE_MINUTES = 120;

export type ReminderTemplate = { id: string; enabled: boolean; offsetMinutes: number };
export type ReminderOptin = { id: string; createdAt: Date; unsubscribedAt: Date | null };
export type DueSend = { emailId: string; optinId: string; sessionKey: string; sendAt: Date; session: ReminderSession };

/** When a reminder for a session goes out. */
export function reminderSendAt(session: Pick<ReminderSession, "startAt">, offsetMinutes: number): Date {
  return new Date(session.startAt.getTime() - Math.max(0, offsetMinutes) * 60_000);
}

export function sendKey(emailId: string, optinId: string, sessionKey: string): string {
  return `${emailId}|${optinId}|${sessionKey}`;
}

/**
 * Every reminder that is due right now and not yet sent. A reminder is due
 * from its send time until the session starts (an "at the start" one, for 30
 * minutes after), and at most MAX_LATE_MINUTES late, so a job that was down for
 * a day does not send yesterday's "starts in 1 hour" email.
 */
export function dueReminders(input: {
  reminders: ReminderTemplate[];
  sessions: ReminderSession[];
  optins: ReminderOptin[];
  sent: ReadonlySet<string>;
  now: Date;
}): DueSend[] {
  const out: DueSend[] = [];
  const now = input.now.getTime();
  for (const reminder of input.reminders) {
    if (!reminder.enabled) continue;
    for (const session of input.sessions) {
      const sendAt = reminderSendAt(session, reminder.offsetMinutes);
      const at = sendAt.getTime();
      const closes = reminder.offsetMinutes > 0 ? session.startAt.getTime() : session.startAt.getTime() + 30 * 60_000;
      if (now < at || now >= closes || now - at > MAX_LATE_MINUTES * 60_000) continue;
      for (const optin of input.optins) {
        if (optin.unsubscribedAt) continue;
        if (optin.createdAt.getTime() > at) continue;
        if (input.sent.has(sendKey(reminder.id, optin.id, session.key))) continue;
        out.push({ emailId: reminder.id, optinId: optin.id, sessionKey: session.key, sendAt, session });
      }
    }
  }
  return out;
}

/** The merge values for one email about one session (or the funnel, for the confirmation). */
export function mergeValues(input: {
  funnelName: string;
  company: string;
  email: string;
  session: ReminderSession | null;
  timeZone: string;
  now: Date;
  pageUrl: string;
  unsubscribeUrl: string;
}): MergeValues {
  const { session } = input;
  const minutes = session ? Math.max(0, Math.round((session.startAt.getTime() - input.now.getTime()) / 60_000)) : 0;
  const time = session ? new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(session.startAt) : "";
  return {
    funnel: input.funnelName,
    company: input.company,
    email: input.email,
    session: session?.label ?? "",
    session_title: session?.title || input.funnelName,
    date: session ? formatZoned(session.startAt, input.timeZone) : "",
    time,
    starts_in: session ? startsIn(minutes) : "",
    link: input.pageUrl,
    room_url: session?.roomUrl ?? "",
    unsubscribe_url: input.unsubscribeUrl,
  };
}

/** Sanitized-HTML body → plain-text alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One ready-to-send email. The unsubscribe link is always present: when the
 * template does not use {unsubscribe_url}, a footer line with it is added.
 */
export function renderEmail(template: { subject: string; bodyHtml: string }, values: MergeValues): { subject: string; html: string; text: string } {
  const subject = fillMergeTags(template.subject, values, "text").replace(/\s+/g, " ").trim().slice(0, 250) || values.funnel || "Reminder";
  let body = fillMergeTags(template.bodyHtml, values, "html");
  const url = values.unsubscribe_url ?? "";
  if (url && !template.bodyHtml.includes("{unsubscribe_url}")) {
    body += `<p style="font-size:12px;color:#667085">You are getting this because you signed up for ${escapeHtmlText(values.funnel ?? "this event")}. <a href="${escapeHtmlText(url)}">Unsubscribe</a>.</p>`;
  }
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.55;color:#1f2937">${body}</div></body></html>`;
  return { subject, html, text: htmlToText(body) };
}

/** Starter templates for a funnel that has none yet. */
export function defaultEmails(live: boolean): { kind: EmailKind; offsetMinutes: number; subject: string; bodyHtml: string; enabled: boolean }[] {
  const confirm = {
    kind: "confirm" as const,
    offsetMinutes: 0,
    enabled: true,
    subject: "You're registered for {funnel}",
    bodyHtml: live
      ? "<p>Thanks for signing up for <strong>{funnel}</strong>.</p><p>We'll send you a reminder before each live session, so you don't miss a thing.</p><p><a href=\"{link}\">Open the event page</a></p>"
      : "<p>Thanks for signing up for <strong>{funnel}</strong>.</p><p>We'll remind you before it starts.</p><p><a href=\"{link}\">Open the event page</a></p>",
  };
  return [
    confirm,
    { kind: "reminder", offsetMinutes: 1440, enabled: true, subject: "{session_title} starts tomorrow", bodyHtml: "<p>A quick reminder: <strong>{session_title}</strong> starts {date}.</p><p><a href=\"{link}\">Save the page</a> so you can join on time.</p>" },
    { kind: "reminder", offsetMinutes: 60, enabled: true, subject: "Starting in 1 hour: {session_title}", bodyHtml: "<p><strong>{session_title}</strong> starts in {starts_in}, at {time}.</p><p><a href=\"{link}\">Join here</a></p>" },
    { kind: "reminder", offsetMinutes: 0, enabled: live, subject: "We're live: {session_title}", bodyHtml: "<p>We're starting now.</p><p><a href=\"{link}\">Join the session</a></p>" },
  ];
}

/** A signed unsubscribe token for one opt-in (no column needed, cannot be guessed). */
export function unsubscribeToken(optinId: string, secret: string): string {
  return createHmac("sha256", secret).update(`pubcommand:funnels:unsubscribe:${optinId}`).digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(optinId: string, token: string, secret: string): boolean {
  if (!secret || typeof token !== "string" || token.length !== 32) return false;
  const expected = unsubscribeToken(optinId, secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
