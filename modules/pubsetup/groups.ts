/**
 * Funnel order: how publication lists are grouped and sorted (wiki and Publication Setup).
 * One rule, here, unit tested in groups.test.ts.
 *
 * 1. Type "Text letter (SMS)" or "Alert service" → Text letters & alerts.
 * 2. Type "Free newsletter" or tier "Free" (old name "Free / lead gen") → Free newsletters.
 * 3. Otherwise the tier decides. No tier (or an unknown one) → Other.
 * Within a group: sortOrder, then name.
 */

export const FUNNEL_GROUPS = [
  { key: "free", label: "Free newsletters" },
  { key: "text", label: "Text letters & alerts" },
  { key: "front", label: "Front-end" },
  { key: "mid", label: "Mid-tier" },
  { key: "back", label: "Back-end" },
  { key: "high", label: "High-ticket" },
  { key: "lifetime", label: "Lifetime / bundles" },
  { key: "bonus", label: "Bonus / complimentary" },
  { key: "other", label: "Other" },
] as const;

export type FunnelGroupKey = (typeof FUNNEL_GROUPS)[number]["key"];

const TEXT_TYPES = new Set(["text letter (sms)", "alert service"]);
const TIER_GROUP: Record<string, FunnelGroupKey> = {
  free: "free",
  // Old name, until every stored row is renamed (migration 20261122150000).
  "free / lead gen": "free",
  "front-end": "front",
  "mid-tier": "mid",
  "back-end": "back",
  "high-ticket": "high",
  lifetime: "lifetime",
  "bonus / complimentary": "bonus",
};

export type FunnelSortable = { name: string; sortOrder?: number | null; pubType?: string | null; tier?: string | null };

export function funnelGroup(pub: Pick<FunnelSortable, "pubType" | "tier">): FunnelGroupKey {
  const type = (pub.pubType ?? "").trim().toLowerCase();
  if (TEXT_TYPES.has(type)) return "text";
  if (type === "free newsletter") return "free";
  return TIER_GROUP[(pub.tier ?? "").trim().toLowerCase()] ?? "other";
}

function byOrderThenName(a: FunnelSortable, b: FunnelSortable): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Non-empty groups in funnel order, each sorted by sortOrder then name. */
export function groupByFunnel<T extends FunnelSortable>(pubs: readonly T[]): { key: FunnelGroupKey; label: string; items: T[] }[] {
  return FUNNEL_GROUPS.map((g) => ({ key: g.key, label: g.label, items: pubs.filter((p) => funnelGroup(p) === g.key).sort(byOrderThenName) })).filter((g) => g.items.length > 0);
}

/** The same order as one flat list. */
export function sortByFunnel<T extends FunnelSortable>(pubs: readonly T[]): T[] {
  return groupByFunnel(pubs).flatMap((g) => g.items);
}
