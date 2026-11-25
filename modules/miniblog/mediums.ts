/**
 * Mini-Blog mediums: how readers get a Mini-Blog (Email, SMS, Push Notification
 * by default). Admins edit the list in Mini-Blog → App settings. The medium picks
 * the subscribe form and is the issue type of the Calendar issues a Mini-Blog's
 * posts create. PURE.
 */

export const DEFAULT_MEDIUMS = ["Email", "SMS", "Push Notification"] as const;

/** Trimmed, single-spaced, 40 characters, de-duplicated (case-insensitive), at most 20. Empty → the defaults. */
export function cleanMediums(input: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input ?? []) {
    if (typeof raw !== "string") continue;
    const value = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= 20) break;
  }
  return out.length ? out : [...DEFAULT_MEDIUMS];
}

/** Mediums from a textarea, one per line (commas also split). */
export function mediumsFromText(text: string): string[] {
  return cleanMediums(text.split(/[\n,]/));
}

export type SubscribeKind = "email" | "none";

/**
 * Which sign-up form a medium gets. Email mediums collect an email address;
 * every other medium (SMS, Push Notification, custom) has NO sign-up form.
 * Mini-Blogs never collect phone numbers or SMS consent: there is no way for a
 * reader to sign up for SMS here.
 */
export function subscribeKind(medium: string | null | undefined): SubscribeKind {
  return /e-?mail|newsletter/i.test(medium ?? "") ? "email" : "none";
}

/** A submitted medium, kept only if it is on the list (or is the Mini-Blog's current one). */
export function acceptMedium(value: string | null | undefined, mediums: readonly string[], current: string | null): string {
  const text = (value ?? "").trim();
  const match = mediums.find((medium) => medium.toLowerCase() === text.toLowerCase());
  if (match) return match;
  if (current && text === current) return current;
  return current ?? mediums[0] ?? DEFAULT_MEDIUMS[1];
}

/** Mediums offered in a dropdown: the list, plus the current value if it was removed from it. */
export function mediumOptions(mediums: readonly string[], current: string | null | undefined): string[] {
  return current && !mediums.includes(current) ? [...mediums, current] : [...mediums];
}
