import { brandProfile, type BrandProfile } from "@pubcommand/core";
import { resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { currentRequest } from "@/lib/request";
import { RATE_WINDOW_MS, hashKey, presentedKey, rateDecision } from "../../../../../modules/support/keys";
import { normalizeScope, type Scope } from "../../../../../modules/support/scope";

/**
 * The agent API (/api/v1/support/...). It answers only on an organization host, only for an
 * organization whose plan includes Support Knowledge, and only with a live agent key. The key
 * IS the scope: nothing the caller says about itself widens it. Every authenticated call is
 * logged to support_api_calls, the audit trail and the rolling rate-limit window.
 */

export type AgentContext = {
  organizationId: string;
  brandId: string;
  brand: BrandProfile;
  origin: string;
  entitled: string[];
  profile: { id: string; name: string; rateLimit: number };
  scope: Scope;
  /** Set by the handler for the call log. */
  query: string;
  hits: number;
};

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function agentJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
}

/** The organization this host serves, with its entitled module ids, when Support Knowledge is on. */
export async function supportOrganization(): Promise<{ id: string; origin: string; entitled: string[] } | null> {
  const request = await currentRequest();
  if (request.site.kind !== "org") return null;
  const resolved = await resolveOrgBySlug(request.site.slug);
  if (!resolved || resolved.suspendedAt || resolved.redirected) return null;
  const org = await tenantDb(resolved.id).organization.findUnique({ where: { id: resolved.id }, include: { plan: { include: { modules: true } }, modules: true } });
  if (!org) return null;
  const disabled = new Set(org.modules.filter((m) => !m.enabled).map((m) => m.moduleId));
  const entitled = org.plan.modules.map((m) => m.moduleId).filter((id) => !disabled.has(id));
  if (!entitled.includes("support")) return null;
  return { id: resolved.id, origin: request.origin, entitled };
}

/** Query string + JSON body (platforms differ in how they send tool arguments). */
export async function agentParams(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value, key) => {
    out[key] = value.slice(0, 1000);
  });
  if (request.method === "POST") {
    const text = await request.text().catch(() => "");
    if (text && text.length < 100_000) {
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        for (const [key, value] of Object.entries(body ?? {})) if (typeof value === "string" || typeof value === "number") out[key] = String(value).slice(0, 1000);
      } catch {
        /* not JSON: query string only */
      }
    }
  }
  return out;
}

async function logCall(organizationId: string, profileId: string, tool: string, query: string, hits: number, status: number, started: number) {
  try {
    const db = tenantDb(organizationId);
    await db.supportApiCall.create({ data: { organizationId, profileId, tool, query: query.slice(0, 300), hits, status, durationMs: Math.round(performance.now() - started) } });
    await db.supportAgentProfile.updateMany({ where: { id: profileId }, data: { lastUsedAt: new Date() } });
  } catch (error) {
    console.error("[support] api call log failed", error);
  }
}

export function withAgent(tool: string, handler: (ctx: AgentContext, params: Record<string, string>) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const org = await supportOrganization();
    if (!org) return agentJson(404, { error: "Not found." });
    const key = presentedKey(request.headers, "agent");
    if (!key) return agentJson(401, { error: "Send the agent key as: Authorization: Bearer psk_…" }, { "www-authenticate": 'Bearer realm="support"' });
    const db = tenantDb(org.id);
    const profile = await db.supportAgentProfile.findFirst({ where: { keyHash: hashKey(key), deletedAt: null } });
    if (!profile || !profile.active) return agentJson(401, { error: "That agent key is not valid or was turned off." }, { "www-authenticate": 'Bearer realm="support"' });
    const brand = await db.brand.findFirst({ where: { id: profile.brandId }, select: { id: true, name: true, niche: true, audience: true, complianceNotes: true } });
    if (!brand) return agentJson(401, { error: "That agent's brand no longer exists." });
    const recent = await db.supportApiCall.count({ where: { profileId: profile.id, createdAt: { gte: new Date(Date.now() - RATE_WINDOW_MS) }, status: { not: 429 } } });
    const decision = rateDecision(recent, profile.rateLimit);
    const limitHeaders = { "x-ratelimit-limit": String(profile.rateLimit), "x-ratelimit-remaining": String(decision.remaining) };
    if (!decision.allowed) {
      await logCall(org.id, profile.id, tool, "", 0, 429, started);
      return agentJson(429, { error: `Rate limit reached (${profile.rateLimit} a minute). Try again shortly.` }, { ...limitHeaders, "retry-after": String(decision.retryAfterSeconds) });
    }
    const ctx: AgentContext = {
      organizationId: org.id,
      brandId: brand.id,
      brand: brandProfile(brand),
      origin: org.origin,
      entitled: org.entitled,
      profile: { id: profile.id, name: profile.name, rateLimit: profile.rateLimit },
      scope: normalizeScope(profile, brand.niche),
      query: "",
      hits: 0,
    };
    let response: Response;
    try {
      response = await handler(ctx, await agentParams(request));
    } catch (error) {
      console.error("[support] agent handler failed", error);
      response = agentJson(500, { error: "Something went wrong. Try again." });
    }
    await logCall(org.id, profile.id, tool, ctx.query, ctx.hits, response.status, started);
    for (const [k, v] of Object.entries(limitHeaders)) response.headers.set(k, v);
    return response;
  };
}

/** Trim long text at a word boundary: a voice agent reads results aloud. */
export function clip(text: string, max = 900): string {
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}
