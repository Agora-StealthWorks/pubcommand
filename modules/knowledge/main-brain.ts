/**
 * The main Brain: platform level, for PubCommand staff only (admin console).
 * Pure rules shared by the console, teachBrain() learning-up and push-down.
 *
 * - Learning up: every note an app teaches a brand mini-brain is copied here,
 *   keyed by `learned:<orgId>:<sourceRef>`, with its provenance.
 * - Push down: staff choose which main-Brain notes reach which brands. A pushed
 *   note is materialized in each target brand's Brain as an ordinary read-only
 *   note (source BEST_PRACTICE_SOURCE, folder "Best practices"), so the brand
 *   never learns where it came from.
 */
import { parseFrontmatter } from "./vault";
import { BEST_PRACTICE_FOLDER, BEST_PRACTICE_SOURCE } from "./visibility";

export const MAIN_BRAIN_MANAGE = "platform.brain.manage";

export type MainOrigin = "LEARNED" | "IMPORTED" | "AUTHORED" | "MIGRATED";
export type PushScope = "NONE" | "ALL" | "SELECTED";

/** Idempotency key for a note learned from an organization's app. */
export function learnedKey(organizationId: string, sourceRef: string): string {
  return `learned:${organizationId}:${sourceRef}`;
}

/** Idempotency key for a vault file imported in the console. */
export function vaultKey(path: string): string {
  return `vault:${path}`;
}

/** sourceRef of the read-only copy of a main-Brain note inside one brand's Brain. */
export function pushedSourceRef(mainNoteId: string, brandId: string): string {
  return `${BEST_PRACTICE_SOURCE}:${mainNoteId}:${brandId}`;
}

export function parsePushedSourceRef(sourceRef: string | null | undefined): { mainNoteId: string; brandId: string } | null {
  const match = /^best-practices:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(sourceRef ?? "");
  return match ? { mainNoteId: match[1]!, brandId: match[2]! } : null;
}

/** Sources that never learn up: people's own notes, imports, and pushed copies. */
const NOT_LEARNED = new Set(["member", "vault-import", BEST_PRACTICE_SOURCE]);

/** Should a mini-brain note be learned by the main Brain? Only notes taught by an app. */
export function shouldLearnUp(note: { source: string; sourceRef: string | null; brandId: string | null }): boolean {
  if (!note.sourceRef) return false;
  if (NOT_LEARNED.has(note.source)) return false;
  if (parsePushedSourceRef(note.sourceRef)) return false;
  return true;
}

export type LearnInput = {
  title: string;
  body: string;
  folder: string | null;
  source: string;
};

export type LearnedRow = {
  title: string;
  body: string;
  folder: string | null;
  editedAt: Date | string | null;
  deletedAt: Date | string | null;
};

/**
 * What learning-up does with an existing main-Brain row:
 * - "create": no row yet;
 * - "refresh": the app wrote new content (unless staff edited it, see below);
 * - "touch": staff edited the note in the console, so their version wins and only
 *   learnedAt moves; or nothing changed;
 * - "skip": staff deleted it from the main Brain: learning never brings it back.
 */
export function learnAction(existing: LearnedRow | null, input: LearnInput): "create" | "refresh" | "touch" | "skip" {
  if (!existing) return "create";
  if (existing.deletedAt) return "skip";
  if (existing.editedAt) return "touch";
  if (existing.title === input.title && existing.body === input.body && (existing.folder ?? null) === (input.folder ?? null)) return "touch";
  return "refresh";
}

export type BrandRef = { id: string; organizationId: string; niche?: string | null };

/**
 * Niche separation: a finance or health note only reaches brands of that same niche, so health
 * and finance knowledge never mix. A general note (craft that fits any publisher) reaches every brand.
 */
export function noteFitsBrand(noteNiche: string | null | undefined, brandNiche: string | null | undefined): boolean {
  const note = noteNiche || "general";
  return note === "general" || note === (brandNiche || "general");
}

/**
 * The brands a note is pushed to. ALL = every brand on the platform (suspended orgs excluded by
 * the caller) of a fitting niche. SELECTED = the chosen brands that still exist and fit the niche.
 */
export function pushTargets(scope: PushScope, selected: readonly BrandRef[], allBrands: readonly BrandRef[], noteNiche: string | null = "general"): BrandRef[] {
  if (scope === "NONE") return [];
  const fits = allBrands.filter((brand) => noteFitsBrand(noteNiche, brand.niche));
  if (scope === "ALL") return fits;
  const chosen = new Set(selected.map((brand) => brand.id));
  return fits.filter((brand) => chosen.has(brand.id));
}

export type PushedCopy = { id: string; brandId: string | null; mainNoteId: string; title: string; body: string; folder: string | null; deletedAt: Date | string | null };

export type PushPlan = {
  create: BrandRef[];
  update: { copyId: string; brand: BrandRef }[];
  /** Copies whose brand is no longer a target (or the note is no longer pushed): soft-deleted. */
  remove: string[];
  unchanged: number;
};

/** Diff the wanted targets for one main note against the copies that exist. */
export function planPush(
  note: { id: string; title: string; body: string },
  targets: readonly BrandRef[],
  copies: readonly PushedCopy[],
): PushPlan {
  const plan: PushPlan = { create: [], update: [], remove: [], unchanged: 0 };
  const mine = copies.filter((copy) => copy.mainNoteId === note.id);
  const byBrand = new Map(mine.map((copy) => [copy.brandId, copy]));
  const wanted = new Set(targets.map((brand) => brand.id));
  for (const brand of targets) {
    const copy = byBrand.get(brand.id);
    if (!copy) plan.create.push(brand);
    else if (copy.deletedAt || copy.title !== note.title || copy.body !== note.body || copy.folder !== BEST_PRACTICE_FOLDER) plan.update.push({ copyId: copy.id, brand });
    else plan.unchanged += 1;
  }
  for (const copy of mine) if (!copy.deletedAt && (!copy.brandId || !wanted.has(copy.brandId))) plan.remove.push(copy.id);
  return plan;
}

export type Provenance = {
  origin: MainOrigin;
  source: string;
  organizationName: string | null;
  brandName: string | null;
  sourceRef: string | null;
};

const ORIGIN_LABELS: Record<MainOrigin, string> = {
  LEARNED: "Learned from an app",
  IMPORTED: "Vault import",
  AUTHORED: "Written in the console",
  MIGRATED: "Moved from an organization's old main Brain",
};

export function originText(origin: MainOrigin): string {
  return ORIGIN_LABELS[origin];
}

/** "Example Gazette · Gazette Daily · Promo Analyzer" (console only). */
export function provenanceLine(p: Provenance, appLabel: (source: string) => string): string {
  const parts = [p.organizationName, p.brandName, p.origin === "LEARNED" || p.origin === "MIGRATED" ? appLabel(p.source) : originText(p.origin)].filter(Boolean);
  return parts.join(" · ") || originText(p.origin);
}

/**
 * Turn a person or publication name into the patterns the entity lookup uses:
 * exact title, title prefix ("Name — Facts"), and a whole-word body mention.
 */
export function entityPatterns(name: string): { exact: string; prefix: string; word: RegExp } | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return null;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return { exact: clean, prefix: clean, word: new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu") };
}

/** How strongly a note is about an entity: 3 = title is the name, 2 = title starts with it, 1 = body mentions it. */
export function entityMatchStrength(note: { title: string; body: string }, name: string): 0 | 1 | 2 | 3 {
  const patterns = entityPatterns(name);
  if (!patterns) return 0;
  const title = note.title.replace(/\s+/g, " ").trim().toLowerCase();
  const target = patterns.exact.toLowerCase();
  if (title === target) return 3;
  if (title.startsWith(`${target} `) || title.startsWith(`${target}—`) || title.startsWith(`${target} —`) || title.startsWith(`${target}:`)) return 2;
  if (patterns.word.test(note.title) || patterns.word.test(note.body)) return 1;
  return 0;
}

// Niche in the markdown -----------------------------------------------------------

const NOTE_NICHES = ["finance", "health", "general"] as const;
export type NoteNiche = (typeof NOTE_NICHES)[number];

/** The `niche:` value in a note's frontmatter, when it is a known niche. */
export function frontmatterNiche(body: string): NoteNiche | null {
  const value = parseFrontmatter(body).data.niche;
  const text = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  return (NOTE_NICHES as readonly string[]).includes(text ?? "") ? (text as NoteNiche) : null;
}

/**
 * Every Master Brain note carries its niche in its own markdown frontmatter (`niche: finance`),
 * kept equal to the niche column: sets the line, adding a frontmatter block when there is none.
 */
export function withNicheFrontmatter(body: string, niche: NoteNiche): string {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(\r?\n|$)/.exec(body);
  if (!match) return `---\nniche: ${niche}\n---\n\n${body}`;
  const lines = (match[1] ?? "").split(/\r?\n/).filter((line, i, all) => !(all.length === 1 && i === 0 && line.trim() === ""));
  const at = lines.findIndex((line) => /^niche\s*:/i.test(line));
  if (at >= 0) lines[at] = `niche: ${niche}`;
  else lines.unshift(`niche: ${niche}`);
  return `---\n${lines.join("\n")}\n---${match[2] || "\n"}${body.slice(match[0].length)}`;
}
