/**
 * Which notes a brand's Brain may see. This is the one place the rule lives
 * (SQL twin in apps/web/src/features/brain/search.ts).
 *
 * A brand sees its own notes, plus notes another brand of the same organization
 * marked SHARED. Rows with no brand (legacy organization-level notes, moved to
 * the platform's own tables) are never visible in an organization.
 */
export type BrainScope = { kind: "brand"; brandId: string };

export type NoteVisibility = "PRIVATE" | "SHARED";

export type VisibleNoteShape = {
  brandId: string | null;
  visibility: NoteVisibility;
  deletedAt?: Date | string | null;
  source?: string;
};

/** Notes a brand receives as read-only best practices carry this source. */
export const BEST_PRACTICE_SOURCE = "best-practices";
/** Folder those notes live in. Plain wording: it never says where they come from. */
export const BEST_PRACTICE_FOLDER = "Best practices";

export function brandScope(brandId: string): BrainScope {
  return { kind: "brand", brandId };
}

export function isBestPractice(note: { source?: string }): boolean {
  return note.source === BEST_PRACTICE_SOURCE;
}

export function canSeeNote(scope: BrainScope, note: VisibleNoteShape): boolean {
  if (note.deletedAt) return false;
  if (!note.brandId) return false;
  if (note.brandId === scope.brandId) return true;
  return note.visibility === "SHARED" && !isBestPractice(note);
}

/**
 * A Prisma `where` for the same rule. Use it with tenantDb, which adds the
 * organization filter on top.
 */
export function scopeWhere(scope: BrainScope): Record<string, unknown> {
  return {
    deletedAt: null,
    OR: [{ brandId: scope.brandId }, { AND: [{ visibility: "SHARED" }, { brandId: { not: null } }, { source: { not: BEST_PRACTICE_SOURCE } }] }],
  };
}

/**
 * Editing stays inside the note's own brand. Best-practice notes are read-only
 * everywhere in an organization.
 */
export function canEditNoteInScope(scope: BrainScope, note: VisibleNoteShape): boolean {
  if (note.deletedAt) return false;
  if (isBestPractice(note)) return false;
  return note.brandId === scope.brandId;
}

/** The brandId new notes get in this scope. */
export function scopeBrandId(scope: BrainScope): string {
  return scope.brandId;
}

/** Pick the brand Brain for a request; null when the organization has no brand yet. */
export function resolveScope(input: { brandId: string | null }): BrainScope | null {
  return input.brandId ? brandScope(input.brandId) : null;
}

/** The brand a visible note belongs to, for the "from" label on another brand's shared note. */
export function originLabel(note: { brandId: string | null }, brandNames: ReadonlyMap<string, string>): string {
  if (!note.brandId) return "This organization";
  return brandNames.get(note.brandId) ?? "Another brand";
}

/** "promo-analyzer" -> "Promo Analyzer"; "member" -> "Written by a member". */
export function sourceLabel(source: string): string {
  if (source === "member") return "Written by a member";
  if (source === "vault-import") return "Vault import";
  if (source === BEST_PRACTICE_SOURCE) return "Best practice";
  if (source === "staff") return "Written in the console";
  const words = source.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return "Unknown";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
