/**
 * Registries: experts (gurus), lists (sender lists / newsletters) and topics.
 * Pure: name keys, resolving names to entries, list matching and merge plans.
 *
 * Every email or video is linked to entries automatically (experts and topics
 * from the AI extraction, the list from the sender). People fix the registry by
 * renaming, adding aliases, ignoring and merging; a merge folds the source's
 * name and aliases into the target, so the same spelling never comes back as a
 * new entry.
 */
import { normalizeAddress } from "./match";

export const ENTITY_KINDS = ["expert", "list", "topic"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_LABELS: Record<EntityKind, { one: string; many: string; route: string }> = {
  expert: { one: "Expert", many: "Experts", route: "/intel/experts" },
  list: { one: "List", many: "Lists", route: "/intel/lists" },
  topic: { one: "Topic", many: "Topics", route: "/intel/topics" },
};

export const LIST_CATEGORIES = ["free", "paid", "hotlist", "marketing"] as const;
export type ListCategory = (typeof LIST_CATEGORIES)[number];
export const LIST_CATEGORY_LABELS: Record<ListCategory, string> = {
  free: "Free editorial",
  paid: "Paid editorial",
  hotlist: "Hotlist / event",
  marketing: "Marketing file",
};

export function isEntityKind(value: string | null | undefined): value is EntityKind {
  return Boolean(value) && (ENTITY_KINDS as readonly string[]).includes(value!);
}

export type RegistryEntry = { id: string; kind: EntityKind; name: string; aliases: readonly string[]; ignored?: boolean };

/**
 * The comparison key for a name: lowercase, accents and punctuation stripped,
 * spaces collapsed. "Dr. Jane O'Neil" and "dr jane oneil" share a key.
 */
export function entityKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}@.+-]+/gu, " ")
    .replace(/(^|\s)[.+-]+|[.+-]+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A display name: trimmed, single spaces, at most 120 characters. Topics are lowercase. */
export function cleanEntityName(kind: EntityKind, name: string): string {
  const text = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return kind === "topic" ? text.toLowerCase() : text;
}

/** key → entry id for one kind. Names win over aliases when two entries collide. */
export function registryIndex(entries: readonly RegistryEntry[], kind: EntityKind): Map<string, string> {
  const index = new Map<string, string>();
  const ofKind = entries.filter((entry) => entry.kind === kind);
  for (const entry of ofKind) {
    for (const alias of entry.aliases) {
      const key = entityKey(alias);
      if (key && !index.has(key)) index.set(key, entry.id);
    }
  }
  for (const entry of ofKind) {
    const key = entityKey(entry.name);
    if (key) index.set(key, entry.id);
  }
  return index;
}

/**
 * Which entries a list of names (from an extraction) points at, and which names
 * need a new entry. Duplicates collapse; blank names are skipped.
 */
export function resolveNames(entries: readonly RegistryEntry[], kind: EntityKind, names: readonly string[]): { ids: string[]; create: string[] } {
  const index = registryIndex(entries, kind);
  const ids: string[] = [];
  const create: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = cleanEntityName(kind, raw);
    const key = entityKey(name);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const id = index.get(key);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      create.push(name);
    }
  }
  return { ids, create };
}

/**
 * The list an email belongs to. A list's aliases may hold sender addresses
 * (exact match wins), otherwise the sender's display name is matched against
 * names and aliases. With no match, the new list is named after the sender and
 * remembers the address.
 */
export function resolveList(
  entries: readonly RegistryEntry[],
  sender: { fromName: string | null; fromAddress: string },
): { id: string } | { create: { name: string; aliases: string[] } } | null {
  const address = normalizeAddress(sender.fromAddress);
  if (!address) return null;
  const lists = entries.filter((entry) => entry.kind === "list");
  for (const entry of lists) {
    if (entry.aliases.some((alias) => normalizeAddress(alias) === address)) return { id: entry.id };
  }
  const displayName = sender.fromName?.replace(/["']/g, "").trim() ?? "";
  if (displayName && !displayName.includes("@")) {
    const key = entityKey(displayName);
    const id = registryIndex(lists, "list").get(key);
    if (id) return { id };
  }
  const name = cleanEntityName("list", displayName && !displayName.includes("@") ? displayName : address);
  return { create: { name, aliases: [address] } };
}

/**
 * Folding `source` into `target`: the target keeps its name and gains the
 * source's name and aliases (deduplicated by key, never its own name).
 */
export function planMerge(source: RegistryEntry, target: RegistryEntry): { aliases: string[] } | { error: string } {
  if (source.id === target.id) return { error: "Pick a different entry to merge into." };
  if (source.kind !== target.kind) return { error: "Only entries of the same kind can be merged." };
  const targetKey = entityKey(target.name);
  const seen = new Set<string>([targetKey]);
  const aliases: string[] = [];
  for (const alias of [...target.aliases, source.name, ...source.aliases]) {
    const key = entityKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias.trim().slice(0, 200));
  }
  return { aliases: aliases.slice(0, 100) };
}

/** Ref moves for a merge: which source refs move to the target and which would duplicate one. */
export function planRefMove(
  sourceRefs: readonly { id: string; emailId: string | null; videoId: string | null }[],
  targetRefs: readonly { emailId: string | null; videoId: string | null }[],
): { move: string[]; drop: string[] } {
  const have = new Set(targetRefs.map((ref) => (ref.emailId ? `e:${ref.emailId}` : `v:${ref.videoId}`)));
  const move: string[] = [];
  const drop: string[] = [];
  for (const ref of sourceRefs) {
    const key = ref.emailId ? `e:${ref.emailId}` : `v:${ref.videoId}`;
    if (have.has(key)) drop.push(ref.id);
    else {
      have.add(key);
      move.push(ref.id);
    }
  }
  return { move, drop };
}

/** Clean the edit form for one entry. */
export function normalizeEntityInput(kind: EntityKind, input: { name: string; aliases: string; category: string; notes: string }) {
  const name = cleanEntityName(kind, input.name);
  const nameKey = entityKey(name);
  const seen = new Set<string>([nameKey]);
  const aliases: string[] = [];
  for (const piece of input.aliases.split(/[\n,;]+/)) {
    const alias = piece.trim().replace(/\s+/g, " ").slice(0, 200);
    const key = entityKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(kind === "list" && normalizeAddress(alias) ? normalizeAddress(alias) : alias);
    if (aliases.length >= 100) break;
  }
  const category = kind === "list" && (LIST_CATEGORIES as readonly string[]).includes(input.category) ? input.category : null;
  return { name, aliases, category, notes: input.notes.trim().slice(0, 4000) || null };
}

/** A name or alias already used by another entry of the same kind, if any (to block confusing edits). */
export function nameConflict(entries: readonly RegistryEntry[], self: { id: string; kind: EntityKind; name: string; aliases: readonly string[] }): string | null {
  const others = entries.filter((entry) => entry.kind === self.kind && entry.id !== self.id);
  const taken = registryIndex(others, self.kind);
  for (const value of [self.name, ...self.aliases]) {
    const key = entityKey(value);
    if (key && taken.has(key)) {
      const other = others.find((entry) => entry.id === taken.get(key));
      return `"${value}" is already used by ${other?.name ?? "another entry"}. Merge them instead.`;
    }
  }
  return null;
}
