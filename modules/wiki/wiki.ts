/**
 * Wiki: pure display helpers over Publication Setup data. The wiki never stores or
 * edits a publication or editor; it filters, searches and summarizes what the read
 * API returns. Unit tested in wiki.test.ts.
 */

export type WikiPublication = {
  id: string;
  code: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  pubType: string | null;
  category?: { name: string } | null;
  tier: string | null;
  frequency: string | null;
  status: string;
  archived: boolean;
  offers: { label: string; price: string; term: string }[];
  editors: { name: string }[];
};

export type WikiEditor = {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  shortBio: string | null;
  specialties: string[];
  status: string;
  publications: { name: string; code: string }[];
};

export const PUB_FILTERS = ["active", "retired", "all"] as const;
export type PubFilter = (typeof PUB_FILTERS)[number];

export function asPubFilter(value: unknown): PubFilter {
  return typeof value === "string" && (PUB_FILTERS as readonly string[]).includes(value) ? (value as PubFilter) : "active";
}

/** "Active" means currently published: anything not retired (launching and paused count). */
export function isCurrent(pub: { status: string; archived: boolean }): boolean {
  return !pub.archived && pub.status !== "retired";
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAll(haystack: (string | null | undefined)[], query: string): boolean {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const text = norm(haystack.filter(Boolean).join(" "));
  return words.every((word) => text.includes(word));
}

/** Publications for the list: status filter, then every search word must appear somewhere. */
export function filterPublications<T extends WikiPublication>(pubs: readonly T[], options: { q?: string; status?: PubFilter }): T[] {
  const status = options.status ?? "active";
  return pubs.filter((pub) => {
    if (pub.archived) return false;
    if (status === "active" && !isCurrent(pub)) return false;
    if (status === "retired" && pub.status !== "retired") return false;
    return matchesAll([pub.name, pub.code, pub.tagline, pub.description, pub.category?.name, pub.tier, pub.frequency, ...pub.editors.map((e) => e.name)], options.q ?? "");
  });
}

export function filterEditors<T extends WikiEditor>(editors: readonly T[], q: string): T[] {
  return editors.filter((e) => matchesAll([e.name, e.title, e.shortBio, ...e.specialties, ...e.publications.map((p) => `${p.name} ${p.code}`)], q));
}

/** One line for a card: the first two price points as typed, e.g. "$49 per year · $199 lifetime". */
export function priceSummary(offers: readonly { label: string; price: string; term: string }[], max = 2): string {
  const parts = offers
    .map((o) => [o.price, o.term].map((s) => s.trim()).filter(Boolean).join(" ") || o.label.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(0, max).join(" · ") + (parts.length > max ? ` · +${parts.length - max} more` : "");
}

/** Home search across both lists. */
export function wikiSearch<P extends WikiPublication, E extends WikiEditor>(pubs: readonly P[], editors: readonly E[], q: string): { publications: P[]; editors: E[] } {
  if (!q.trim()) return { publications: [], editors: [] };
  return { publications: filterPublications(pubs, { q, status: "all" }).slice(0, 20), editors: filterEditors(editors, q).slice(0, 20) };
}

/** Initials for an avatar with no photo. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

/** Only http(s) links are rendered as links (Publication Setup validates, this is belt and braces). */
export function safeHref(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
