import { organizationHasModule, resolveOrgBySlug, tenantDb, type Prisma } from "@pubcommand/db";
import { currentRequest } from "@/lib/request";
import { RATE_WINDOW_MS, bearerKey, hasScope, hashApiKey, rateDecision, type ApiScope } from "../../../../../modules/charts/api-keys";
import { listTemplates, type Scope, type TemplateRow } from "./server";

/**
 * The bot API (/api/v1/charts/...). It answers only on an organization host, only for organizations that
 * have ChartBuilder, and only with a live key for one of their brands. Every authenticated call is logged
 * to chart_api_calls, which is both the audit trail and the rolling rate-limit window.
 */

export type ApiContext = {
  organizationId: string;
  brandId: string;
  brandName: string;
  origin: string;
  key: { id: string; name: string; scopes: string[]; rateLimit: number };
  scope: Scope;
  remaining: number;
  /** Set by a handler that made or read a chart, for the call log. */
  chartId: string | null;
};

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function apiJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...headers } });
}

export function apiError(status: number, error: string, field?: string, headers: Record<string, string> = {}): Response {
  return apiJson(status, field ? { error, field } : { error }, headers);
}

/** The organization this host serves, if it has ChartBuilder turned on. */
export async function apiOrganization(): Promise<{ id: string; origin: string } | null> {
  const request = await currentRequest();
  if (request.site.kind !== "org") return null;
  const resolved = await resolveOrgBySlug(request.site.slug);
  if (!resolved || resolved.suspendedAt) return null;
  if (!(await organizationHasModule(resolved.id, "charts"))) return null;
  return { id: resolved.id, origin: request.origin };
}

async function authenticate(request: Request, needed: ApiScope | null): Promise<{ ok: true; ctx: ApiContext } | { ok: false; response: Response; keyId?: string; organizationId?: string }> {
  const org = await apiOrganization();
  if (!org) return { ok: false, response: apiError(404, "Not found.") };
  const presented = bearerKey(request.headers);
  if (!presented) return { ok: false, response: apiError(401, "Send your ChartBuilder API key as: Authorization: Bearer pcc_…", undefined, { "www-authenticate": 'Bearer realm="chartbuilder"' }) };
  const db = tenantDb(org.id);
  const key = await db.chartApiKey.findFirst({ where: { keyHash: hashApiKey(presented) } });
  if (!key || key.revokedAt) return { ok: false, response: apiError(401, "That API key is not valid or was revoked.", undefined, { "www-authenticate": 'Bearer realm="chartbuilder"' }) };
  const brand = await db.brand.findFirst({ where: { id: key.brandId }, select: { id: true, name: true } });
  if (!brand) return { ok: false, response: apiError(401, "That API key's brand no longer exists."), keyId: key.id, organizationId: org.id };
  if (needed && !hasScope(key.scopes, needed)) {
    return { ok: false, response: apiError(403, `This key does not have the ${needed} scope.`), keyId: key.id, organizationId: org.id };
  }
  const recent = await db.chartApiCall.count({ where: { keyId: key.id, createdAt: { gte: new Date(Date.now() - RATE_WINDOW_MS) }, status: { not: 429 } } });
  const decision = rateDecision(recent, key.rateLimit);
  const limitHeaders = { "x-ratelimit-limit": String(key.rateLimit), "x-ratelimit-remaining": String(decision.remaining) };
  if (!decision.allowed) {
    return {
      ok: false,
      response: apiError(429, `Rate limit reached: ${key.rateLimit} requests a minute for this key. Try again shortly.`, undefined, { ...limitHeaders, "retry-after": String(decision.retryAfterSeconds) }),
      keyId: key.id,
      organizationId: org.id,
    };
  }
  return {
    ok: true,
    ctx: {
      organizationId: org.id,
      brandId: brand.id,
      brandName: brand.name,
      origin: org.origin,
      key: { id: key.id, name: key.name, scopes: key.scopes, rateLimit: key.rateLimit },
      scope: { organizationId: org.id, brandId: brand.id, brandName: brand.name, actorId: null },
      remaining: decision.remaining,
      chartId: null,
    },
  };
}

async function logCall(organizationId: string, keyId: string, request: Request, status: number, started: number, chartId: string | null) {
  try {
    const url = new URL(request.url);
    const db = tenantDb(organizationId);
    await db.chartApiCall.create({
      data: { organizationId, keyId, method: request.method, path: url.pathname.slice(0, 300), status, chartId, durationMs: Math.round(performance.now() - started) },
    });
    await db.chartApiKey.updateMany({ where: { id: keyId }, data: { lastUsedAt: new Date() } });
  } catch (error) {
    console.error("[charts] api call log failed", error);
  }
}

/** Wrap a route handler: authenticate, check the scope and rate limit, run, log. */
export function withApi(needed: ApiScope | null, handler: (ctx: ApiContext, request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const auth = await authenticate(request, needed);
    if (!auth.ok) {
      if (auth.keyId && auth.organizationId) await logCall(auth.organizationId, auth.keyId, request, auth.response.status, started, null);
      return auth.response;
    }
    let response: Response;
    try {
      response = await handler(auth.ctx, request);
    } catch (error) {
      console.error("[charts] api handler failed", error);
      response = apiError(500, "Something went wrong on our side. Try again.");
    }
    await logCall(auth.ctx.organizationId, auth.ctx.key.id, request, response.status, started, auth.ctx.chartId);
    response.headers.set("x-ratelimit-limit", String(auth.ctx.key.rateLimit));
    response.headers.set("x-ratelimit-remaining", String(auth.ctx.remaining));
    return response;
  };
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (text.length > 3_000_000) return { ok: false, response: apiError(413, "The request body is too large (3 MB max).") };
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: apiError(400, "The body is not valid JSON.") };
  }
}

/** A template by slug, id or name (case-insensitive). No name → the first Promo template. */
export function findTemplate(templates: TemplateRow[], wanted: unknown): TemplateRow | null | undefined {
  if (wanted === undefined || wanted === null || wanted === "") return templates.find((t) => t.category === "PROMO") ?? templates[0] ?? null;
  if (typeof wanted !== "string") return undefined;
  const w = wanted.trim().toLowerCase();
  return templates.find((t) => t.slug?.toLowerCase() === w || t.id === w || t.name.toLowerCase() === w);
}

export async function templatesFor(organizationId: string) {
  return listTemplates(organizationId);
}

type ChartOut = {
  id: string;
  name: string;
  symbol: string;
  seriesName: string;
  source: string;
  headline: string;
  headlineOverridden: boolean;
  stats: Prisma.JsonValue | null;
  tokens: Prisma.JsonValue;
  warnings: Prisma.JsonValue;
  fileToken: string | null;
  createdAt: Date;
  batchId?: string | null;
  projectId?: string | null;
};

export function fileUrls(origin: string, token: string | null) {
  if (!token) return null;
  const base = `${origin}/api/v1/charts/files/${token}`;
  return { png: `${base}.png`, jpg: `${base}.jpg`, svg: `${base}.svg`, svgFonts: `${base}.svg?fonts=embed`, pdf: `${base}.pdf`, ai: `${base}.ai` };
}

/** The JSON a bot gets for a chart: the figures the data produced, warnings, and file links. */
export function chartJson(origin: string, row: ChartOut) {
  const tokens = (row.tokens && typeof row.tokens === "object" ? row.tokens : {}) as Record<string, string>;
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    title: row.seriesName,
    source: row.source,
    headline: row.headline,
    headlineOverridden: row.headlineOverridden,
    stats: row.stats,
    figures: Object.fromEntries(Object.entries(tokens).filter(([key]) => /^(gain|gainRounded|start|end|cagr|span|from|to)\d*$/.test(key))),
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    batchId: row.batchId ?? null,
    projectId: row.projectId ?? null,
    createdAt: row.createdAt.toISOString(),
    editorUrl: `${origin}/charts?chart=${row.id}`,
    files: fileUrls(origin, row.fileToken),
  };
}

export const CHART_JSON_SELECT = {
  id: true,
  name: true,
  symbol: true,
  seriesName: true,
  source: true,
  headline: true,
  headlineOverridden: true,
  stats: true,
  tokens: true,
  warnings: true,
  fileToken: true,
  createdAt: true,
  batchId: true,
  projectId: true,
} as const;
