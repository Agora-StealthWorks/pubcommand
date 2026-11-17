/**
 * Agent scope. The API key an agent presents IS its scope: categories × audiences stored
 * on its profile. A request may narrow that scope (one category), never widen it, and a
 * brand outside the finance niche never gets the track-record category whatever is stored.
 */
import { AUDIENCES, CATEGORY_KEYS, categoriesForNiche, isAudience, isCategory, type Audience, type Category } from "./taxonomy";

export type Scope = { categories: Category[]; audiences: Audience[] };

/** Clean a stored or submitted scope: known values only, canonical order, niche rule applied. */
export function normalizeScope(input: { categories: readonly unknown[]; audiences: readonly unknown[] }, niche: string): Scope {
  const allowed = new Set(categoriesForNiche(niche));
  const wantedCategories = new Set(input.categories.filter(isCategory));
  const wantedAudiences = new Set(input.audiences.filter(isAudience));
  return {
    categories: CATEGORY_KEYS.filter((key) => wantedCategories.has(key) && allowed.has(key)),
    audiences: AUDIENCES.filter((key) => wantedAudiences.has(key)),
  };
}

/**
 * The scope one request may read: the profile's scope, intersected with what the caller
 * asked for. Asking for a category the profile lacks gives an empty scope, not the
 * profile's whole scope, so a crafted request can only ever see less.
 */
export function effectiveScope(profile: Scope, requested: { category?: string | null; audience?: string | null } = {}): Scope {
  const category = requested.category?.trim().toLowerCase();
  const audience = requested.audience?.trim().toLowerCase();
  return {
    categories: category ? profile.categories.filter((key) => key === category) : [...profile.categories],
    audiences: audience ? profile.audiences.filter((key) => key === audience) : [...profile.audiences],
  };
}

export function scopeAllows(scope: Scope, category: string, audience: string): boolean {
  return (scope.categories as string[]).includes(category) && (scope.audiences as string[]).includes(audience);
}

/** Searchable record categories in a scope (trades are live-only and never indexed). */
export function searchableCategories(scope: Scope): Category[] {
  return scope.categories.filter((key) => key !== "trades");
}

/** Track record needs the trades category, the member audience and a finance brand. */
export function tradesAllowed(scope: Scope, niche: string): boolean {
  return niche === "finance" && scope.categories.includes("trades") && scope.audiences.includes("member");
}

export function isEmptyScope(scope: Scope): boolean {
  return scope.categories.length === 0 || scope.audiences.length === 0;
}
