import { subscribeKind } from "./mediums";

/**
 * Mini-Blog site rules: slugs, go-live checks, colours, CSV export, excerpts and
 * the Brain note for a post. Pure (no DB), unit tested.
 */

export function normalizeSlug(input: string, max = 60): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug);
}

/** Post slugs that would collide with a Mini-Blog's own routes. */
export const RESERVED_POST_SLUGS = ["subscribe", "asset", "logo", "feed", "archive", "go", "px"] as const;

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isHexColor(value: string | null | undefined): boolean {
  return Boolean(value) && /^#[0-9a-f]{6}$/i.test(value!.trim());
}

export function safeColor(value: string | null | undefined, fallback: string): string {
  return isHexColor(value) ? value!.trim().toLowerCase() : fallback;
}

/** Readable text colour on a background colour. */
export function contrastText(hex: string): string {
  const value = safeColor(hex, "#111827").slice(1);
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!) > 0.45 ? "#0b1220" : "#ffffff";
}

export type CheckResult = { errors: string[]; warnings: string[] };

export type SiteCheckInput = { name: string; slug: string; privacyUrl: string | null; termsUrl: string | null; programName: string; helpContact: string; medium?: string | null };

/**
 * Go-live checks. Errors block going live. An SMS Mini-Blog needs privacy and
 * terms links and a program name (carriers require them on an opt-in page); an
 * email one needs a privacy link; other mediums have no subscribe form.
 */
export function checkSite(input: SiteCheckInput): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind = subscribeKind(input.medium ?? "SMS");
  if (!input.name.trim()) errors.push("Give the Mini-Blog a name.");
  if (!isValidSlug(input.slug)) errors.push("The link name must be lowercase letters, numbers and dashes.");
  if (kind === "sms") {
    if (!isHttpUrl(input.privacyUrl)) errors.push("Add a privacy-policy link. Carriers require it on every opt-in page.");
    if (!isHttpUrl(input.termsUrl)) errors.push("Add a terms link (SMS terms of service).");
    if (!input.programName.trim()) errors.push("Name the text program (for example the publication name).");
    if (!input.helpContact.trim()) warnings.push("Add a HELP contact (email or phone) so subscribers know how to reach you.");
  } else if (kind === "email") {
    if (!isHttpUrl(input.privacyUrl)) errors.push("Add a privacy-policy link. It is shown on the email sign-up form.");
  } else {
    warnings.push(`${input.medium} Mini-Blogs have no subscribe form yet; readers reach posts by link.`);
  }
  return { errors, warnings };
}

export type PostState = "draft" | "scheduled" | "published";

/** A published post with a future publish time is "scheduled": hidden from visitors until then. */
export function postState(post: { status: string; publishAt: Date }, now: Date): PostState {
  if (post.status !== "published") return "draft";
  return post.publishAt > now ? "scheduled" : "published";
}

/** One CSV cell: quoted, and with spreadsheet formulas neutralized. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Plain numbers (including E.164 phones like +15551234567) are not formulas.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Plain text from sanitized HTML, for excerpts and Brain notes. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function excerpt(html: string, max = 180): string {
  const text = htmlToText(html).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

/**
 * The Brain note for a published post. Its sourceRef stays `tletter-post:<id>`
 * (see features/miniblog/brain.ts), so notes written before the rename keep
 * updating. Aggregates only: never a phone number.
 */
export function postBrainNote(input: {
  siteName: string;
  title: string;
  publishLabel: string;
  bodyHtml: string;
  actionToTake: string | null;
  siteOptins: number;
  postViews: number;
}): { title: string; body: string } {
  const text = htmlToText(input.bodyHtml);
  const words = text ? text.split(/\s+/).length : 0;
  return {
    title: `Mini-Blog post: ${input.title}`,
    body: [
      `# Mini-Blog post: ${input.title}`,
      "",
      `Published on the ${input.siteName} Mini-Blog, ${input.publishLabel}. ${words} words.`,
      input.actionToTake ? `Action to take: ${input.actionToTake}` : "",
      "",
      "## Post",
      text.slice(0, 4000),
      "",
      "## Reach (aggregates)",
      `- Post page views: ${input.postViews}.`,
      `- Mini-Blog subscribers (all time): ${input.siteOptins}.`,
    ]
      .filter((line, index, all) => line !== "" || all[index - 1] !== "")
      .join("\n"),
  };
}

/**
 * The Marketing Calendar status for a published post's issue: "Scheduled"
 * until it goes live, then "Sent". The calendar job flips issues the moment a
 * scheduled post's time passes. Other statuses a person set by hand (anything
 * but Scheduled) are left alone.
 */
export function calendarStatusFor(publishAt: Date, now: Date, status: string = "published"): "Drafting" | "Scheduled" | "Sent" {
  if (status !== "published") return "Drafting";
  return publishAt > now ? "Scheduled" : "Sent";
}

export function shouldFlipToSent(issueStatus: string, post: { status: string; publishAt: Date; deletedAt: Date | null }, now: Date): boolean {
  return issueStatus === "Scheduled" && post.status === "published" && !post.deletedAt && post.publishAt <= now;
}
