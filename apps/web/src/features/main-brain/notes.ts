import { rawPrisma, type Prisma } from "@pubcommand/db";
import { anyWordsQuery } from "../../../../../modules/knowledge/ask";
import { entityMatchStrength } from "../../../../../modules/knowledge/main-brain";
import { linkResolver, linksTo } from "../../../../../modules/knowledge/wikilinks";
import { cleanSnippet, HIT_CLOSE, HIT_OPEN } from "../brain/search";
import { mainBrain } from "./db";

/** Columns for lists (no body). */
export const MAIN_LIST_SELECT = {
  id: true,
  title: true,
  folder: true,
  origin: true,
  niche: true,
  source: true,
  originOrganizationId: true,
  originBrandId: true,
  pushScope: true,
  updatedAt: true,
} as const;

export type MainNoteRow = Prisma.MainBrainNoteGetPayload<{ select: typeof MAIN_LIST_SELECT }>;

export type MainFilter = {
  folder?: string | null;
  organizationId?: string | null;
  brandId?: string | null;
  source?: string | null;
  origin?: "LEARNED" | "IMPORTED" | "AUTHORED" | "MIGRATED" | null;
  pushed?: boolean;
  /** Exactly this niche ("finance" | "health" | "general"). */
  niche?: string | null;
};

const UUID = /^[0-9a-f-]{36}$/i;

export function filterWhere(filter: MainFilter): Prisma.MainBrainNoteWhereInput {
  const where: Prisma.MainBrainNoteWhereInput[] = [{ deletedAt: null }];
  if (filter.folder) where.push({ OR: [{ folder: filter.folder }, { folder: { startsWith: `${filter.folder}/` } }] });
  if (filter.organizationId && UUID.test(filter.organizationId)) where.push({ originOrganizationId: filter.organizationId });
  if (filter.brandId && UUID.test(filter.brandId)) where.push({ originBrandId: filter.brandId });
  if (filter.source) where.push({ source: filter.source });
  if (filter.origin) where.push({ origin: filter.origin });
  if (filter.pushed) where.push({ pushScope: { not: "NONE" } });
  if (filter.niche === "finance" || filter.niche === "health" || filter.niche === "general") where.push({ niche: filter.niche });
  return { AND: where };
}

export async function getMainNote(id: string) {
  if (!UUID.test(id)) return null;
  return mainBrain((tx) => tx.mainBrainNote.findFirst({ where: { id, deletedAt: null }, include: { pushTargets: true, attachments: { select: { id: true, filename: true, contentType: true, size: true, createdAt: true } } } }));
}

export async function listMainNotes(filter: MainFilter, options: { take?: number; orderBy?: "updated" | "title" } = {}) {
  return mainBrain((tx) =>
    tx.mainBrainNote.findMany({
      where: filterWhere(filter),
      select: MAIN_LIST_SELECT,
      orderBy: options.orderBy === "title" ? { title: "asc" } : { updatedAt: "desc" },
      take: options.take ?? 50,
    }),
  );
}

export async function mainStats() {
  return mainBrain(async (tx) => {
    const [byOrigin, pushed, sources] = await Promise.all([
      tx.mainBrainNote.groupBy({ by: ["origin"], where: { deletedAt: null }, _count: { _all: true } }),
      tx.mainBrainNote.count({ where: { deletedAt: null, pushScope: { not: "NONE" } } }),
      tx.mainBrainNote.groupBy({ by: ["source"], where: { deletedAt: null }, _count: { _all: true }, orderBy: { source: "asc" } }),
    ]);
    const origin = Object.fromEntries(byOrigin.map((row) => [row.origin, row._count._all])) as Record<string, number>;
    const total = Object.values(origin).reduce((sum, n) => sum + n, 0);
    return { total, origin, pushed, sources: sources.map((row) => ({ source: row.source, count: row._count._all })) };
  });
}

/** Learned-note counts per organization and brand, for the provenance filter. */
export async function provenanceCounts() {
  return mainBrain((tx) =>
    tx.mainBrainNote.groupBy({
      by: ["originOrganizationId", "originBrandId"],
      where: { deletedAt: null, originOrganizationId: { not: null } },
      _count: { _all: true },
    }),
  );
}

export async function mainFolderCounts(filter: Omit<MainFilter, "folder"> = {}): Promise<{ folder: string | null; count: number }[]> {
  const rows = await mainBrain((tx) => tx.mainBrainNote.groupBy({ by: ["folder"], where: filterWhere(filter), _count: { _all: true } }));
  return rows.map((row) => ({ folder: row.folder, count: row._count._all }));
}

export type MainHit = MainNoteRow & { rank: number; snippet: string };

/** Full-text search over the main Brain (same ranking as a brand Brain). */
export async function searchMainNotes(input: { query: string; mode?: "all" | "any"; limit?: number; filter?: MainFilter }): Promise<MainHit[]> {
  const raw = input.query.replace(/\s+/g, " ").trim().slice(0, 300);
  const text = input.mode === "any" ? anyWordsQuery(raw) : raw;
  if (!text) return [];
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const values: unknown[] = [];
  const param = (value: unknown, cast = "") => {
    values.push(value);
    return `$${values.length}${cast}`;
  };
  const tsquery = param(text);
  const niche = input.filter?.niche;
  const nicheSql = niche === "finance" || niche === "health" || niche === "general" ? ` AND n.niche = ${param(niche)}` : "";
  const titleMatch = input.mode === "any" ? "FALSE" : `n.title ILIKE ${param(`%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
  const headline = param(`StartSel=${HIT_OPEN}, StopSel=${HIT_CLOSE}, MaxWords=28, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`);
  const rows = await mainBrain((tx) =>
    tx.$queryRawUnsafe<{ id: string; rank: number | string; snippet: string }[]>(
      `SELECT n.id,
              (ts_rank_cd(n.search_vector, w.query, 32) + CASE WHEN ${titleMatch} THEN 1 ELSE 0 END)::float8 AS rank,
              ts_headline('english', left(n.body, 40000), w.query, ${headline}) AS snippet
       FROM main_brain_notes n, websearch_to_tsquery('english', ${tsquery}) AS w(query)
       WHERE n.deleted_at IS NULL${nicheSql} AND (n.search_vector @@ w.query OR ${titleMatch})
       ORDER BY rank DESC, n.updated_at DESC
       LIMIT ${param(Math.min(limit * 4, 400), "::int")}`,
      ...values,
    ),
  );
  if (rows.length === 0) return [];
  // Apply the console filters through Prisma (keeps the SQL small and the filters in one place).
  const meta = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { AND: [filterWhere(input.filter ?? {}), { id: { in: rows.map((row) => row.id) } }] }, select: MAIN_LIST_SELECT }));
  const byId = new Map(meta.map((row) => [row.id, row]));
  return rows
    .flatMap((row) => {
      const note = byId.get(row.id);
      return note ? [{ ...note, rank: Number(row.rank), snippet: cleanSnippet(row.snippet) }] : [];
    })
    .slice(0, limit);
}

export async function mainLinkIndex() {
  const rows = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { deletedAt: null }, select: { id: true, title: true } }));
  return rows.map((row) => ({ ...row, brandId: null, visibility: "PRIVATE" as const }));
}

export async function mainResolver() {
  return linkResolver(await mainLinkIndex(), null);
}

export async function mainBacklinks(note: { id: string; title: string }) {
  const candidates = await mainBrain((tx) =>
    tx.mainBrainNote.findMany({
      where: { deletedAt: null, id: { not: note.id }, body: { contains: note.title, mode: "insensitive" }, AND: [{ body: { contains: "[[" } }] },
      select: { id: true, title: true, body: true },
      take: 200,
    }),
  );
  return candidates.filter((row) => linksTo(row.body, note.title)).map(({ body: _body, ...row }) => row);
}

/** Names for provenance: organizations and brands by id (platform read). */
export async function provenanceNames(): Promise<{ orgs: Map<string, { name: string; slug: string }>; brands: Map<string, { name: string; organizationId: string }> }> {
  const [orgs, brands] = await Promise.all([
    rawPrisma().organization.findMany({ select: { id: true, name: true, slug: true } }),
    rawPrisma().brand.findMany({ select: { id: true, name: true, organizationId: true } }),
  ]);
  return {
    orgs: new Map(orgs.map((org) => [org.id, { name: org.name, slug: org.slug }])),
    brands: new Map(brands.map((brand) => [brand.id, { name: brand.name, organizationId: brand.organizationId }])),
  };
}

export type EntityNote = MainNoteRow & { strength: 1 | 2 | 3; originSourceRef: string | null };

/**
 * HOOK for the main-Brain conflict review (next agent): every live main-Brain
 * note about one entity (a publication or editor name from Publication Setup),
 * strongest first. Strength 3 = the title is the name, 2 = the title starts with
 * it ("Name — Facts"), 1 = the title or body mentions it as a whole phrase.
 * Optional `aliases` (e.g. a publication code) widen the match. Read-only;
 * platform staff only (never call it from org code).
 */
export async function listMainBrainNotesByEntity(name: string, options: { aliases?: string[]; limit?: number } = {}): Promise<EntityNote[]> {
  const names = [name, ...(options.aliases ?? [])].map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 2);
  if (names.length === 0) return [];
  const rows = await mainBrain((tx) =>
    tx.mainBrainNote.findMany({
      where: { deletedAt: null, OR: names.flatMap((value) => [{ title: { contains: value, mode: "insensitive" as const } }, { body: { contains: value, mode: "insensitive" as const } }]) },
      select: { ...MAIN_LIST_SELECT, body: true, originSourceRef: true },
      take: 2000,
    }),
  );
  return rows
    .flatMap(({ body, ...row }) => {
      const strength = Math.max(...names.map((value) => entityMatchStrength({ title: row.title, body }, value)));
      return strength > 0 ? [{ ...row, strength: strength as 1 | 2 | 3 }] : [];
    })
    .sort((a, b) => b.strength - a.strength || b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, options.limit ?? 200);
}
