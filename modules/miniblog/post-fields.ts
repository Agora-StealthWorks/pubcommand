/**
 * Internal-only post fields from the T-Letter site: categories and tickers.
 * Neither is ever shown on a public page. PURE.
 */

/** A Mini-Blog's category list: trimmed, 60 characters, de-duplicated (case-insensitive), at most 50. */
export function cleanCategories(input: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input ?? []) {
    if (typeof raw !== "string") continue;
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= 50) break;
  }
  return out;
}

/** Categories from a textarea, one per line. */
export function categoriesFromText(text: string): string[] {
  return cleanCategories(text.split(/\n/));
}

/** A submitted category, in the list's own casing; null when blank or not on the list. */
export function acceptCategory(value: string | null | undefined, allowed: readonly string[]): string | null {
  const name = (value ?? "").trim();
  if (!name) return null;
  return allowed.find((item) => item.toLowerCase() === name.toLowerCase()) ?? null;
}

/** "nvda, amd / TSLA" → ["NVDA", "AMD", "TSLA"]: 1–10 letters (dots and dashes allowed), at most 20. */
export function parseTickers(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (text ?? "").toUpperCase().split(/[\s,;/|]+/)) {
    const symbol = raw.replace(/^\$/, "");
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || out.includes(symbol)) continue;
    out.push(symbol);
    if (out.length >= 20) break;
  }
  return out;
}
