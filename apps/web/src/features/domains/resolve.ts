/**
 * Custom host → { orgSlug, targetPath } for the middleware.
 *
 * The middleware runs on the Node.js runtime (Next 15.5, `runtime: "nodejs"`),
 * in the same process as the app, so it can use Prisma directly. Lookups are
 * cached in memory per process: hits for 60s, misses for 30s, so unknown hosts
 * (bots probing the Railway IP) cost one query per host per half minute. A
 * removed domain stops serving within a minute.
 */

import { rawPrisma } from "@pubcommand/db";

export type ResolvedHost = { organizationId: string; orgSlug: string; targetPath: string; redirectToHost: string | null };

const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;

type Entry = { value: ResolvedHost | null; expires: number };
const cache = new Map<string, Entry>();

/** Cross-organization lookup: RLS is bypassed for this one read only (by hostname, a platform-unique key). */
export async function lookupCustomHost(hostname: string): Promise<ResolvedHost | null> {
  const rows = await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.$queryRaw<{ organization_id: string; slug: string; target_path: string; redirect_to_host: string | null; suspended_at: Date | null }[]>`
      SELECT d.organization_id, o.slug, d.target_path, d.redirect_to_host, o.suspended_at
      FROM custom_domains d
      JOIN organizations o ON o.id = d.organization_id
      WHERE d.hostname = ${hostname}
      LIMIT 1`;
  });
  const row = rows[0];
  if (!row || row.suspended_at) return null;
  return { organizationId: row.organization_id, orgSlug: row.slug, targetPath: row.target_path, redirectToHost: row.redirect_to_host };
}

export async function resolveCustomHost(hostname: string, now = Date.now()): Promise<ResolvedHost | null> {
  const key = hostname.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.value;
  let value: ResolvedHost | null = null;
  try {
    value = await lookupCustomHost(key);
  } catch (error) {
    // Database trouble: serve a stale answer if we have one rather than 404 a live domain.
    if (cached) return cached.value;
    console.error(JSON.stringify({ msg: "custom domain lookup failed", host: key, error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, expires: now + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  return value;
}

export function clearCustomHostCache(): void {
  cache.clear();
}
