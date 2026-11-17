/**
 * Directory: publishers, experts and products seen across a brand's promos.
 * People correct the list with overrides (rename, merge, alias, hide). An
 * override changes what is displayed; the promo keeps its detected value.
 * Pure functions, unit tested.
 */

export const ENTITY_KINDS = ["publisher", "guru", "product"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const ENTITY_LABELS: Record<EntityKind, string> = { publisher: "Publishers", guru: "Experts", product: "Products" };

export type EntityOverride = { kind: EntityKind; fromKey: string; fromName: string; toName: string | null; hidden: boolean };

export function entityKey(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
}

/** Follow rename/merge overrides to the display name (cycle safe). */
export function resolveName(kind: EntityKind, name: string, overrides: readonly EntityOverride[]): string {
  let current = name.trim();
  const seen = new Set<string>();
  for (;;) {
    const key = entityKey(current);
    if (seen.has(key)) return current;
    seen.add(key);
    const hit = overrides.find((o) => o.kind === kind && o.fromKey === key && o.toName);
    if (!hit) return current;
    current = hit.toName!;
  }
}

export function isHidden(kind: EntityKind, name: string, overrides: readonly EntityOverride[]): boolean {
  const key = entityKey(resolveName(kind, name, overrides));
  return overrides.some((o) => o.kind === kind && o.fromKey === key && o.hidden);
}

export type DirectoryPromo = {
  id: string;
  title: string;
  publisher: string | null;
  gurus: string[];
  product: string | null;
  score: number | null;
  realScore: number | null;
};

export type DirectoryEntry = {
  key: string;
  name: string;
  /** Original names that resolve here (excluding the display name). */
  aliases: string[];
  hidden: boolean;
  promoCount: number;
  averageScore: number | null;
  averageReal: number | null;
  promos: { id: string; title: string; score: number | null }[];
};

export function namesFor(kind: EntityKind, promo: DirectoryPromo): string[] {
  if (kind === "publisher") return promo.publisher ? [promo.publisher] : [];
  if (kind === "product") return promo.product ? [promo.product] : [];
  return promo.gurus;
}

const average = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

/** One entry per resolved name, with counts and averages. Hidden entries are flagged, not dropped. */
export function buildDirectory(kind: EntityKind, promos: readonly DirectoryPromo[], overrides: readonly EntityOverride[]): DirectoryEntry[] {
  const groups = new Map<string, { name: string; originals: Set<string>; promos: Map<string, DirectoryPromo> }>();
  for (const promo of promos) {
    for (const raw of namesFor(kind, promo)) {
      if (!raw.trim()) continue;
      const name = resolveName(kind, raw, overrides);
      const key = entityKey(name);
      if (!key) continue;
      const group = groups.get(key) ?? { name, originals: new Set<string>(), promos: new Map() };
      group.originals.add(raw.trim());
      group.promos.set(promo.id, promo);
      groups.set(key, group);
    }
  }
  // Aliases added by hand for names not seen yet still show on their entry.
  for (const override of overrides) {
    if (override.kind !== kind || !override.toName) continue;
    const key = entityKey(resolveName(kind, override.toName, overrides));
    groups.get(key)?.originals.add(override.fromName);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const list = [...group.promos.values()];
      return {
        key,
        name: group.name,
        aliases: [...group.originals].filter((original) => entityKey(original) !== key).sort(),
        hidden: overrides.some((o) => o.kind === kind && o.fromKey === key && o.hidden),
        promoCount: list.length,
        averageScore: average(list.map((p) => p.score).filter((s): s is number => s != null)),
        averageReal: average(list.map((p) => p.realScore).filter((s): s is number => s != null)),
        promos: list.map((p) => ({ id: p.id, title: p.title, score: p.score })),
      };
    })
    .sort((a, b) => b.promoCount - a.promoCount || a.name.localeCompare(b.name));
}

export type OverrideChange = { upsert: { fromKey: string; fromName: string; toName: string }[]; error?: string };

/**
 * Plan a rename / merge / alias: point `from` at `into`. Overrides that pointed
 * at `from` are re-pointed at `into` so there are no chains. Refuses a
 * change that would point a name at itself or make a loop.
 */
export function planMerge(kind: EntityKind, from: string, into: string, overrides: readonly EntityOverride[]): OverrideChange {
  const fromName = from.trim();
  const target = into.trim();
  if (!fromName || !target) return { upsert: [], error: "Both names are needed." };
  const fromKey = entityKey(fromName);
  const finalName = resolveName(kind, target, overrides);
  const finalKey = entityKey(finalName);
  if (!fromKey || !finalKey) return { upsert: [], error: "Use letters or numbers in the name." };
  if (fromKey === finalKey) {
    // Same key: only a change of spelling or capitals ("alex green" -> "Alex Green").
    if (resolveName(kind, fromName, overrides) === finalName && fromName === finalName) return { upsert: [], error: "Those are already the same entry." };
    return { upsert: [{ fromKey, fromName, toName: finalName }] };
  }
  const upsert = [{ fromKey, fromName, toName: finalName }];
  for (const override of overrides) {
    if (override.kind !== kind || !override.toName || override.fromKey === fromKey) continue;
    if (entityKey(override.toName) === fromKey) upsert.push({ fromKey: override.fromKey, fromName: override.fromName, toName: finalName });
  }
  return { upsert };
}

/** Display a promo's fields through the overrides, keeping the originals for a tooltip. */
export function displayEntities(promo: { publisher: string | null; gurus: string[]; product: string | null }, overrides: readonly EntityOverride[]) {
  const show = (kind: EntityKind, name: string | null) => (name ? { name: resolveName(kind, name, overrides), original: name } : null);
  const gurus = [...new Map(promo.gurus.map((g) => [entityKey(resolveName("guru", g, overrides)), { name: resolveName("guru", g, overrides), original: g }])).values()];
  return { publisher: show("publisher", promo.publisher), gurus, product: show("product", promo.product) };
}
