/**
 * Form themes (the old app's "templates"): logo, colours, privacy-policy link.
 * The public form, the embed and the builder preview all call resolveTheme so
 * the preview can never drift from what respondents see.
 */
import type { ResolvedTheme } from "./types";
import { collectsPii } from "./fields";
import { endRuleProblems, logicProblems } from "./logic";
import type { EndRule, FieldDef, FormLayout } from "./types";

export type ThemeInput = {
  logoSrc: string | null;
  logoHeight: number | null;
  headerSize: string;
  barColor: string;
  accentColor: string;
  privacyPolicyUrl: string;
  companyName: string;
  footerText: string | null;
};

export const HEADER_SIZES = { standard: 36, tall: 72 } as const;
export const DEFAULT_BAR = "#0b1220";
export const DEFAULT_ACCENT = "#1d4ed8";

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && isHexColor(value) ? value.trim().toLowerCase() : fallback;
}

/** Exact height wins (16–160px); otherwise the size preset. */
export function logoHeightPx(theme: { logoHeight: number | null; headerSize: string } | null): number {
  if (theme?.logoHeight && Number.isFinite(theme.logoHeight)) return Math.min(160, Math.max(16, Math.round(theme.logoHeight)));
  return theme?.headerSize === "tall" ? HEADER_SIZES.tall : HEADER_SIZES.standard;
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function resolveTheme(theme: ThemeInput | null, brandName: string): ResolvedTheme {
  return {
    brandName,
    logoSrc: theme?.logoSrc ?? null,
    logoHeight: logoHeightPx(theme),
    barColor: safeColor(theme?.barColor, DEFAULT_BAR),
    accentColor: safeColor(theme?.accentColor, DEFAULT_ACCENT),
    privacyPolicyUrl: theme && isHttpUrl(theme.privacyPolicyUrl) ? theme.privacyPolicyUrl.trim() : null,
    companyName: theme?.companyName?.trim() || brandName,
    footerText: theme?.footerText?.trim() ?? "",
  };
}

/** Readable text colour on a background. */
export function contrastText(hex: string): string {
  const value = safeColor(hex, DEFAULT_BAR).slice(1);
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return luminance > 0.45 ? "#0b1220" : "#ffffff";
}

/** The disclaimer shown under the submit button. The privacy link is appended by the renderer and cannot be removed. */
export function disclaimerText(override: string | null | undefined, companyName: string, fields: readonly FieldDef[]): string {
  if (override?.trim()) return override.trim();
  if (collectsPii(fields)) {
    return `By submitting, you agree that ${companyName} may store the details you provide and contact you about this request.`;
  }
  return `${companyName} stores your answers to improve what it offers.`;
}

export function normalizeFormSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isValidFormSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug);
}

/** Why a form cannot be published yet. Empty means it can. */
export function publishProblems(input: {
  title: string;
  slug: string;
  fields: readonly FieldDef[];
  layout: FormLayout;
  theme: { privacyPolicyUrl: string } | null;
  endRules?: readonly EndRule[];
}): string[] {
  const problems: string[] = [];
  if (!input.title.trim()) problems.push("Give the form a title.");
  if (!isValidFormSlug(input.slug)) problems.push("Set a link name (letters, numbers and dashes).");
  if (!input.fields.some((field) => !["hidden", "page_break", "statement", "divider"].includes(field.type))) {
    problems.push("Add at least one question.");
  }
  if (!input.theme) problems.push("Pick a theme. Every public form shows its privacy-policy link.");
  else if (!isHttpUrl(input.theme.privacyPolicyUrl)) problems.push("The theme needs a privacy-policy URL starting with https://");
  for (const field of input.fields) {
    if (field.config.choices && field.config.choices.length === 0) problems.push(`“${field.label || "A choice question"}” needs at least one option.`);
    if ((field.config.rows && field.config.rows.length === 0) || (field.config.columns && field.config.columns.length === 0)) {
      problems.push(`“${field.label || "A grid question"}” needs at least one row and one column.`);
    }
    if (!["statement", "page_break", "divider"].includes(field.type) && !field.label.trim()) problems.push("Every question needs a label.");
  }
  problems.push(...logicProblems(input.fields, input.layout));
  problems.push(...endRuleProblems(input.fields, input.endRules ?? []));
  return [...new Set(problems)];
}

export type FormWindow = { status: string; opensAt: Date | null; closesAt: Date | null; responseLimit: number | null };

/** Whether a public form takes responses right now, and if not, why. */
export function acceptingResponses(form: FormWindow, completeCount: number, now: Date): { open: boolean; reason: string | null } {
  if (form.status !== "OPEN") return { open: false, reason: "This form is not open." };
  if (form.opensAt && now < form.opensAt) return { open: false, reason: "This form is not open yet." };
  if (form.closesAt && now >= form.closesAt) return { open: false, reason: "This form has closed." };
  if (form.responseLimit && completeCount >= form.responseLimit) return { open: false, reason: "This form has all the responses it needs." };
  return { open: true, reason: null };
}

/** Spam check. Flagged responses are KEPT (a browser autofill can trip the honeypot) and held out of default figures. */
export function spamVerdict(input: { honeypot: string; startedAt: number | null; now: number }): string | null {
  if (input.honeypot.trim()) return "honeypot";
  if (input.startedAt && input.now - input.startedAt < 2500) return "too-fast";
  return null;
}

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** UTM parameters from a query string, trimmed and capped. */
export function captureUtm(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) utm[key] = value.slice(0, 200);
  }
  return utm;
}

/** Hidden-field values taken from the link: ?<queryParam>=value, or the field's default. */
export function hiddenValues(fields: readonly FieldDef[], search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.type !== "hidden") continue;
    const fromLink = field.config.queryParam ? params.get(field.config.queryParam)?.trim() : "";
    const value = fromLink || field.config.defaultValue || "";
    if (value) values[field.id] = value.slice(0, 500);
  }
  return values;
}
