/**
 * Which notes a Brain view may see. This is the one place the rule lives.
 *
 * - main Brain (brandId null view): every note in the organization. Learning flows up.
 * - a brand's mini-brain: its own notes, plus notes marked SHARED (from any brand
 *   or the main Brain). Nothing PRIVATE from another brand or the main Brain.
 */
export type BrainScope = { kind: "main" } | { kind: "brand"; brandId: string };

export type NoteVisibility = "PRIVATE" | "SHARED";

export type VisibleNoteShape = {
  brandId: string | null;
  visibility: NoteVisibility;
  deletedAt?: Date | string | null;
};

export const MAIN_SCOPE: BrainScope = { kind: "main" };

export function brandScope(brandId: string): BrainScope {
  return { kind: "brand", brandId };
}

export function canSeeNote(scope: BrainScope, note: VisibleNoteShape): boolean {
  if (note.deletedAt) return false;
  if (scope.kind === "main") return true;
  return note.brandId === scope.brandId || note.visibility === "SHARED";
}

/**
 * A Prisma `where` for the same rule. Use it with tenantDb, which adds the
 * organization filter on top.
 */
export function scopeWhere(scope: BrainScope): Record<string, unknown> {
  if (scope.kind === "main") return { deletedAt: null };
  return { deletedAt: null, OR: [{ brandId: scope.brandId }, { visibility: "SHARED" }] };
}

/**
 * Editing stays inside the note's own Brain: a brand edits only its own notes
 * (never another brand's Shared note); the main Brain can edit any note.
 */
export function canEditNoteInScope(scope: BrainScope, note: VisibleNoteShape): boolean {
  if (note.deletedAt) return false;
  if (scope.kind === "main") return true;
  return note.brandId === scope.brandId;
}

/** The brandId new notes get in this scope. */
export function scopeBrandId(scope: BrainScope): string | null {
  return scope.kind === "brand" ? scope.brandId : null;
}

export function scopeParam(scope: BrainScope): "main" | "brand" {
  return scope.kind;
}

/**
 * Pick the scope for a request. `requested` is the ?scope= value. Members tied
 * to one brand never get the main Brain, whatever they ask for.
 */
export function resolveScope(input: {
  requested: string | undefined | null;
  brandId: string | null;
  mainAllowed: boolean;
}): BrainScope | null {
  const wantsMain = input.requested === "main";
  if (wantsMain && input.mainAllowed) return MAIN_SCOPE;
  if (input.brandId) return brandScope(input.brandId);
  return input.mainAllowed ? MAIN_SCOPE : null;
}

/** Where a note lives, for the "from" label. */
export function originLabel(note: { brandId: string | null }, brandNames: ReadonlyMap<string, string>): string {
  if (!note.brandId) return "Main Brain";
  return brandNames.get(note.brandId) ?? "Another brand";
}

/** "promo-analyzer" -> "Promo Analyzer"; "member" -> "Written by a member". */
export function sourceLabel(source: string): string {
  if (source === "member") return "Written by a member";
  if (source === "vault-import") return "Vault import";
  const words = source.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return "Unknown";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
