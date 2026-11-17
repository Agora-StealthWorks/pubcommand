/**
 * Outline operations for Research Extractor: sections hold bullets, bullets
 * hold cards. Every operation is pure and returns new arrays; the server turns
 * the result into position writes with `positionChanges`.
 */

export type Ordered = { id: string; position: number };

/** Sort by position, then id, so ties never reorder at random. */
export function sortByPosition<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** The position for a new item at the end of a list. */
export function nextPosition(items: readonly Ordered[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}

/** Move one id up or down by one place. Unknown ids and moves past an end return the list unchanged. */
export function moveStep(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Move an id to an index (clamped). Inserts it if it is not in the list yet. */
export function moveTo(ids: readonly string[], id: string, index: number): string[] {
  const without = ids.filter((item) => item !== id);
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : without.length, without.length));
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * The writes needed to make `ordered` the new order: positions become 0..n-1
 * and only rows whose position actually changes are returned.
 */
export function positionChanges(current: readonly Ordered[], ordered: readonly string[]): { id: string; position: number }[] {
  const known = new Map(current.map((item) => [item.id, item.position]));
  const changes: { id: string; position: number }[] = [];
  ordered.forEach((id, position) => {
    if (known.has(id) && known.get(id) !== position) changes.push({ id, position });
  });
  return changes;
}

/** Bullet id → ordered card ids. */
export type Placement = Record<string, string[]>;

/** Put a card on a bullet (at `index`, default the end). A card already there just moves. */
export function attachCard(placement: Placement, bulletId: string, cardId: string, index?: number): Placement {
  const list = placement[bulletId] ?? [];
  return { ...placement, [bulletId]: moveTo(list, cardId, index ?? list.length) };
}

export function detachCard(placement: Placement, bulletId: string, cardId: string): Placement {
  if (!placement[bulletId]) return placement;
  return { ...placement, [bulletId]: placement[bulletId]!.filter((id) => id !== cardId) };
}

/** Move a card from one bullet to another. Moving onto the same bullet reorders it. */
export function moveCard(placement: Placement, input: { cardId: string; from: string; to: string; index?: number }): Placement {
  if (input.from === input.to) return attachCard(placement, input.to, input.cardId, input.index);
  return attachCard(detachCard(placement, input.from, input.cardId), input.to, input.cardId, input.index);
}

/** How many bullets each card sits on, so the tray can show which cards are already used. */
export function usageCounts(placement: Placement): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ids of Object.values(placement)) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** A starter outline for an empty project: one section per topic group, one bullet per card. */
export function outlineFromGroups(cards: readonly { id: string; topic: string; groupName: string | null }[]): { title: string; bullets: { text: string; cardIds: string[] }[] }[] {
  const groups = new Map<string, { text: string; cardIds: string[] }[]>();
  for (const card of cards) {
    const name = card.groupName?.trim() || "Ungrouped";
    groups.set(name, [...(groups.get(name) ?? []), { text: card.topic, cardIds: [card.id] }]);
  }
  const named = [...groups.entries()].filter(([name]) => name !== "Ungrouped");
  const rest = groups.get("Ungrouped");
  return [...named, ...(rest ? [["Ungrouped", rest] as const] : [])].map(([title, bullets]) => ({ title, bullets }));
}
