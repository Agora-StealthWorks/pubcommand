import { rawPrisma, withOrgContext } from "@pubcommand/db";
import { anyWordsQuery } from "../../../../../modules/knowledge/ask";
import type { BrainScope } from "../../../../../modules/knowledge/visibility";

/**
 * Full-text search over Brain notes. Every query here ALWAYS filters by the
 * organization and by the scope's visibility rule (modules/knowledge/visibility.ts):
 * main Brain = every note in the org; a brand = its own notes + SHARED notes.
 * Deleted notes never match.
 */

export type NoteHit = {
  id: string;
  title: string;
  folder: string | null;
  brandId: string | null;
  visibility: "PRIVATE" | "SHARED";
  source: string;
  updatedAt: Date;
  rank: number;
  /** Plain text with «matched» words marked. Never HTML. */
  snippet: string;
};

export const HIT_OPEN = "«";
export const HIT_CLOSE = "»";

/** A tiny parameterized SQL builder: values never enter the SQL text. */
class Query {
  readonly values: unknown[] = [];
  param(value: unknown, cast = ""): string {
    this.values.push(value);
    return `$${this.values.length}${cast}`;
  }
}

/** The SQL form of canSeeNote(). Keep the two in step (the tests check both). */
function visibilitySql(scope: BrainScope, query: Query): string {
  if (scope.kind === "main") return "TRUE";
  return `(p.brand_id = ${query.param(scope.brandId, "::uuid")} OR p.visibility = 'SHARED')`;
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Organization + not deleted + visibility. Every Brain query here starts with this. */
function baseWhere(organizationId: string, scope: BrainScope, query: Query): string {
  return `p.organization_id = ${query.param(organizationId, "::uuid")} AND p.deleted_at IS NULL AND ${visibilitySql(scope, query)}`;
}

export async function searchNotes(input: {
  organizationId: string;
  scope: BrainScope;
  query: string;
  /** "all": every word must match (search box). "any": rank notes matching any word (Ask the Brain). */
  mode?: "all" | "any";
  limit?: number;
  folder?: string | null;
}): Promise<NoteHit[]> {
  const raw = input.query.replace(/\s+/g, " ").trim().slice(0, 300);
  const text = input.mode === "any" ? anyWordsQuery(raw) : raw;
  if (!text) return [];
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const q = new Query();
  const tsquery = q.param(text);
  const where = baseWhere(input.organizationId, input.scope, q);
  const titleMatch = input.mode === "any" ? "FALSE" : `p.title ILIKE ${q.param(`%${likeEscape(raw)}%`)}`;
  const folderSql = input.folder
    ? `AND (p.folder = ${q.param(input.folder)} OR p.folder LIKE ${q.param(`${likeEscape(input.folder)}/%`)})`
    : "";
  const headline = q.param(`StartSel=${HIT_OPEN}, StopSel=${HIT_CLOSE}, MaxWords=28, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`);
  const sql = `
    SELECT p.id, p.title, p.folder, p.brand_id AS "brandId", p.visibility::text AS visibility, p.source,
           p.updated_at AS "updatedAt",
           (ts_rank_cd(p.search_vector, w.query, 32) + CASE WHEN ${titleMatch} THEN 1 ELSE 0 END)::float8 AS rank,
           ts_headline('english', left(p.body, 40000), w.query, ${headline}) AS snippet
    FROM knowledge_pages p, websearch_to_tsquery('english', ${tsquery}) AS w(query)
    WHERE ${where}
      AND (p.search_vector @@ w.query OR ${titleMatch})
      ${folderSql}
    ORDER BY rank DESC, p.updated_at DESC
    LIMIT ${q.param(limit, "::int")}`;
  const rows = await withOrgContext(rawPrisma(), input.organizationId, (tx) =>
    tx.$queryRawUnsafe<(Omit<NoteHit, "rank"> & { rank: number | string })[]>(sql, ...q.values),
  );
  return rows.map((row) => ({ ...row, rank: Number(row.rank), snippet: cleanSnippet(row.snippet) }));
}

/** Drop Markdown/HTML noise from a headline so it reads as plain text. */
export function cleanSnippet(value: string): string {
  return value
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/** Note counts per folder, for the sidebar tree. Same org + visibility filter. */
export async function folderCounts(organizationId: string, scope: BrainScope): Promise<{ folder: string | null; count: number }[]> {
  const q = new Query();
  const sql = `SELECT p.folder, count(*) AS count FROM knowledge_pages p WHERE ${baseWhere(organizationId, scope, q)} GROUP BY p.folder`;
  const rows = await withOrgContext(rawPrisma(), organizationId, (tx) =>
    tx.$queryRawUnsafe<{ folder: string | null; count: bigint | number }[]>(sql, ...q.values),
  );
  return rows.map((row) => ({ folder: row.folder, count: Number(row.count) }));
}
