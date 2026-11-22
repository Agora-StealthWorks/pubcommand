/**
 * Publication categories: a brand's own short list ("Free newsletters", "Trading services"...)
 * that publications are filed under. Admins manage it in Publication Setup; public websites
 * list publications grouped by it. Pure (no DB) and unit tested in categories.test.ts.
 *
 * Order everywhere: category sortOrder, then category name; inside a category the
 * publication's sortOrder, then its name. Uncategorized publications come last.
 */
import { PUBLICATION_TYPES } from "./fields";

export type Category = { id: string; name: string; sortOrder: number };

export const CATEGORY_NAME_MAX = 60;

/** A tidy category name, or null when it is empty or too long. */
export function categoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= CATEGORY_NAME_MAX ? name : null;
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The category with this name (any case), if the brand has one. */
export function findCategory<T extends { name: string }>(categories: readonly T[], name: string): T | undefined {
  return categories.find((category) => sameName(category.name, name));
}

export function byCategoryOrder(a: Pick<Category, "name" | "sortOrder">, b: Pick<Category, "name" | "sortOrder">): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function sortCategories<T extends Pick<Category, "name" | "sortOrder">>(categories: readonly T[]): T[] {
  return [...categories].sort(byCategoryOrder);
}

type Sortable = { name: string; sortOrder?: number | null; categoryId?: string | null };

function byPubOrder(a: Sortable, b: Sortable): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export type CategoryGroup<T> = { category: Category | null; key: string; label: string; items: T[] };

/**
 * Non-empty groups in category order, publications sorted inside each. Publications with no
 * category (or one that no longer exists) go in a last group labelled `uncategorizedLabel`.
 */
export function groupByCategory<T extends Sortable>(pubs: readonly T[], categories: readonly Category[], uncategorizedLabel = "More"): CategoryGroup<T>[] {
  const known = new Set(categories.map((category) => category.id));
  const groups: CategoryGroup<T>[] = sortCategories(categories).map((category) => ({
    category,
    key: category.id,
    label: category.name,
    items: pubs.filter((pub) => pub.categoryId === category.id).sort(byPubOrder),
  }));
  groups.push({ category: null, key: "none", label: uncategorizedLabel, items: pubs.filter((pub) => !pub.categoryId || !known.has(pub.categoryId)).sort(byPubOrder) });
  return groups.filter((group) => group.items.length > 0);
}

/** The same order as one flat list. */
export function sortByCategory<T extends Sortable>(pubs: readonly T[], categories: readonly Category[]): T[] {
  return groupByCategory(pubs, categories).flatMap((group) => group.items);
}

/** The old Type list, in its order: seeded categories keep it. */
export const LEGACY_TYPE_ORDER: readonly string[] = PUBLICATION_TYPES;

/** Sort order for a category seeded from a Type (unknown Types go after the known ones). */
export function seedOrder(type: string): number {
  const index = LEGACY_TYPE_ORDER.findIndex((known) => sameName(known, type));
  return (index === -1 ? 100 : index + 1) * 10;
}

/**
 * The seed (mirrors the SQL in migration 20261122120000): one category per distinct Type a
 * brand uses, named like the Type, unless the brand already has one with that name; then every
 * publication without a category is put in its Type's category. Running it again changes nothing.
 */
export function planCategorySeed(
  pubs: readonly { id: string; pubType: string | null; categoryId: string | null }[],
  existing: readonly Category[],
): { create: { name: string; sortOrder: number }[]; assign: { publicationId: string; categoryName: string }[] } {
  const create: { name: string; sortOrder: number }[] = [];
  const assign: { publicationId: string; categoryName: string }[] = [];
  for (const pub of pubs) {
    const type = (pub.pubType ?? "").trim();
    if (!type) continue;
    if (!findCategory(existing, type) && !findCategory(create, type)) create.push({ name: type, sortOrder: seedOrder(type) });
    if (!pub.categoryId) assign.push({ publicationId: pub.id, categoryName: findCategory(existing, type)?.name ?? findCategory(create, type)!.name });
  }
  return { create, assign };
}

/** New sort orders after moving one category up or down (10, 20, 30...). */
export function moveCategory(categories: readonly Category[], id: string, direction: "up" | "down"): { id: string; sortOrder: number }[] {
  const list = sortCategories(categories);
  const index = list.findIndex((category) => category.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index !== -1 && target >= 0 && target < list.length) [list[index], list[target]] = [list[target]!, list[index]!];
  return list.map((category, i) => ({ id: category.id, sortOrder: (i + 1) * 10 }));
}
