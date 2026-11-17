import { rawPrisma, withOrgContext } from "@pubcommand/db";
import { searchableCategories, type Scope } from "../../../../../modules/support/scope";
import { idf, joinIntent, searchWords } from "../../../../../modules/support/search";

/**
 * Agent-facing reads. Every query here filters by organization, brand, status = published
 * and the caller's scope (categories × audiences) IN SQL, so a key can only ever read what
 * its profile allows, whatever the request says. The admin search uses the same functions
 * with the full scope.
 */

class Query {
  readonly values: unknown[] = [];
  param(value: unknown, cast = ""): string {
    this.values.push(value);
    return `$${this.values.length}${cast}`;
  }
}

export type ReadScope = { organizationId: string; brandId: string; scope: Scope };

/** The scope filter. Empty arrays match nothing (ANY of an empty array is false). */
function scopeWhere(alias: string, read: ReadScope, q: Query, opts: { includeDrafts?: boolean } = {}): string {
  return [
    `${alias}.organization_id = ${q.param(read.organizationId, "::uuid")}`,
    `${alias}.brand_id = ${q.param(read.brandId, "::uuid")}`,
    opts.includeDrafts ? `${alias}.status <> 'archived'` : `${alias}.status = 'published'`,
    `${alias}.category = ANY(${q.param(searchableCategories(read.scope), "::text[]")})`,
    `${alias}.audience = ANY(${q.param(read.scope.audiences, "::text[]")})`,
  ].join(" AND ");
}

function run<T>(organizationId: string, sql: string, values: unknown[]): Promise<T[]> {
  return withOrgContext(rawPrisma(), organizationId, (tx) => tx.$queryRawUnsafe<T[]>(sql, ...values));
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type Hit = { recordId: string; category: string; audience: string; title: string; content: string; url: string | null; rank: number };

/**
 * Full-text search with rarity weighting: each query word gets ln(N/df) over the passages
 * in scope, a passage scores the sum of the words it contains (title matches count twice),
 * ts_rank breaks ties, and pricing gets a boost on "how do I join / what does it cost".
 * At most two passages per record.
 */
export async function searchKnowledge(read: ReadScope, query: string, options: { k?: number; includeDrafts?: boolean } = {}): Promise<Hit[]> {
  const words = searchWords(query);
  if (!words.length || !searchableCategories(read.scope).length || !read.scope.audiences.length) return [];
  const k = Math.min(Math.max(options.k ?? 6, 1), 20);

  const countQ = new Query();
  const countWhere = scopeWhere("c", read, countQ, options);
  const wordsParam = countQ.param(words, "::text[]");
  const counts = await run<{ w: string | null; df: number; n: number }>(
    read.organizationId,
    `SELECT w.word AS w,
            (SELECT count(*)::int FROM support_chunks c WHERE ${countWhere} AND c.search_vector @@ plainto_tsquery('english', w.word)) AS df,
            (SELECT count(*)::int FROM support_chunks c WHERE ${countWhere}) AS n
     FROM unnest(${wordsParam}) AS w(word)`,
    countQ.values,
  );
  const n = counts[0]?.n ?? 0;
  const terms = counts.filter((row) => row.w && row.df > 0).map((row) => ({ w: row.w as string, weight: idf(n, row.df) }));
  if (!n || !terms.length) return [];

  const q = new Query();
  const where = scopeWhere("c", read, q, options);
  const score = terms
    .map((t) => {
      const w = q.param(t.w);
      const weight = q.param(t.weight, "::float8");
      return `(CASE WHEN c.search_vector @@ plainto_tsquery('english', ${w}) THEN ${weight} ELSE 0 END + CASE WHEN to_tsvector('english', c.title) @@ plainto_tsquery('english', ${w}) THEN ${weight} ELSE 0 END)`;
    })
    .join(" + ");
  const orQuery = q.param(terms.map((t) => t.w).join(" | "));
  const boost = q.param(joinIntent(query) ? 2 : 0, "::float8");
  const rows = await run<Omit<Hit, "rank"> & { rank: number | string }>(
    read.organizationId,
    `SELECT c.record_id AS "recordId", c.category, c.audience, c.title, c.content, r.url,
            ((${score}) + ts_rank(c.search_vector, to_tsquery('english', ${orQuery})) + CASE WHEN c.category = 'pricing' THEN ${boost} ELSE 0 END)::float8 AS rank
     FROM support_chunks c JOIN support_records r ON r.id = c.record_id
     WHERE ${where} AND c.search_vector @@ to_tsquery('english', ${orQuery})
     ORDER BY rank DESC, c.ord ASC
     LIMIT ${q.param(k * 4, "::int")}`,
    q.values,
  );
  const perRecord = new Map<string, number>();
  return rows
    .map((row) => ({ ...row, rank: Number(row.rank) }))
    .filter((row) => {
      const seen = perRecord.get(row.recordId) ?? 0;
      perRecord.set(row.recordId, seen + 1);
      return seen < 2;
    })
    .slice(0, k);
}

export type ScopedRecord = { id: string; category: string; audience: string; title: string; body: string; summary: string; url: string | null; publicationCodes: string[]; updatedAt: Date };

/** One record, only when it is published and inside the scope. */
export async function getScopedRecord(read: ReadScope, id: string): Promise<ScopedRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const q = new Query();
  const where = scopeWhere("r", read, q);
  const rows = await run<ScopedRecord>(
    read.organizationId,
    `SELECT r.id, r.category, r.audience, r.title, r.body, r.summary, r.url, r.publication_codes AS "publicationCodes", r.updated_at AS "updatedAt"
     FROM support_records r WHERE ${where} AND r.id = ${q.param(id, "::uuid")} LIMIT 1`,
    q.values,
  );
  return rows[0] ?? null;
}

/** Published records per category inside the scope. */
export async function categoryCounts(read: ReadScope): Promise<{ category: string; count: number }[]> {
  const q = new Query();
  return run<{ category: string; count: number }>(
    read.organizationId,
    `SELECT r.category, count(*)::int AS count FROM support_records r WHERE ${scopeWhere("r", read, q)} GROUP BY r.category ORDER BY r.category`,
    q.values,
  );
}

export type Article = { id: string; title: string; url: string | null; publishedAt: string | null; audience: string; publicationCodes: string[]; summary: string };

/** Website directory lookup by topic words, publication and date, newest first. */
export async function findArticles(read: ReadScope, input: { topic?: string; publication?: string; from?: string; to?: string; limit?: number }): Promise<Article[]> {
  const scope: Scope = { categories: read.scope.categories.filter((c) => c === "website"), audiences: read.scope.audiences };
  const q = new Query();
  const parts = [scopeWhere("r", { ...read, scope }, q)];
  const words = searchWords(input.topic ?? "");
  if (words.length) {
    parts.push(`EXISTS (SELECT 1 FROM support_chunks c WHERE c.record_id = r.id AND c.search_vector @@ to_tsquery('english', ${q.param(words.join(" | "))}))`);
  }
  const pub = input.publication?.trim();
  if (pub) {
    parts.push(`(${q.param(pub.toUpperCase())} = ANY(r.publication_codes) OR r.meta->>'product' ILIKE ${q.param(`%${likeEscape(pub)}%`)})`);
  }
  if (input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from)) parts.push(`r.meta->>'publishedAt' >= ${q.param(input.from)}`);
  if (input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) parts.push(`r.meta->>'publishedAt' <= ${q.param(input.to)}`);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  return run<Article>(
    read.organizationId,
    `SELECT r.id, r.title, r.url, r.meta->>'publishedAt' AS "publishedAt", r.audience, r.publication_codes AS "publicationCodes", r.summary
     FROM support_records r WHERE ${parts.join(" AND ")}
     ORDER BY r.meta->>'publishedAt' DESC NULLS LAST, r.title ASC LIMIT ${q.param(limit, "::int")}`,
    q.values,
  );
}
