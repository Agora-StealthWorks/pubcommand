/**
 * Pages & links: where custom pages, external links and "coming soon"
 * placeholders sit among the modules. PURE.
 *
 * An item with `afterModule = N` sits right after the N-th module (0 = before
 * the first); null, or a number past the last module, puts it at the end.
 * Items in the same slot keep their `sort` order, then their list order.
 */
export const NAV_KINDS = ["page", "link", "placeholder"] as const;
export type NavKind = (typeof NAV_KINDS)[number];
export const TITLE_PLACEMENTS = ["outside", "inside", "hidden"] as const;
export type TitlePlacement = (typeof TITLE_PLACEMENTS)[number];

export type NavPlacement = { afterModule: number | null; sort: number };

export type NavEntry<D, I> = { kind: "day"; day: D; index: number } | { kind: "item"; item: I };

/** Days (already in module order) and items, interleaved in display order. */
export function navSequence<D, I extends NavPlacement>(days: readonly D[], items: readonly I[]): NavEntry<D, I>[] {
  const slotOf = (item: I) => (item.afterModule === null || !Number.isFinite(item.afterModule) || item.afterModule > days.length ? days.length : Math.max(0, Math.floor(item.afterModule)));
  const ordered = items
    .map((item, order) => ({ item, order, slot: slotOf(item) }))
    .sort((a, b) => a.slot - b.slot || a.item.sort - b.item.sort || a.order - b.order);
  const out: NavEntry<D, I>[] = [];
  let next = 0;
  for (let slot = 0; slot <= days.length; slot += 1) {
    while (next < ordered.length && ordered[next]!.slot === slot) out.push({ kind: "item", item: ordered[next++]!.item });
    if (slot < days.length) out.push({ kind: "day", day: days[slot]!, index: slot });
  }
  return out;
}

/** The navigation strip: every module, plus the items marked "show in navigation". */
export function navStrip<D, I extends NavPlacement & { showInNav: boolean }>(days: readonly D[], items: readonly I[]): NavEntry<D, I>[] {
  return navSequence(days, items.filter((item) => item.showInNav));
}

/** The agenda: every module, plus placeholders marked "list in the agenda". */
export function agendaSequence<D, I extends NavPlacement & { kind: string; showInAgenda: boolean }>(days: readonly D[], items: readonly I[]): NavEntry<D, I>[] {
  return navSequence(days, items.filter((item) => item.kind === "placeholder" && item.showInAgenda));
}

/** Page slugs that would collide with the funnel's own routes. */
export const RESERVED_PAGE_SLUGS = ["sync", "optin", "logo", "thumb", "asset", "ics", "p"] as const;

/** Renumber `sort` 0..n-1 after moving one item up or down. Returns the ids in their new order. */
export function moveItem(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
