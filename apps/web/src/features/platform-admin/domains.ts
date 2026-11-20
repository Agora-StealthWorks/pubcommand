import type { DomainDetachResult, PurgeDomain } from "@pubcommand/db";
import { clearCustomHostCache } from "@/features/domains/resolve";
import type { RailwayClient } from "@/features/domains/railway";
import { railwayFromEnv } from "@/features/domains/railway";

/**
 * Best-effort removal of a purged organization's custom domains from the Railway
 * service. Never touches a registrar: a domain bought through PubCommand stays
 * registered (cancelling a registration happens at the registrar).
 */
export async function detachDomainsFromRailway(domains: PurgeDomain[], railway: RailwayClient | null = railwayFromEnv()): Promise<DomainDetachResult[]> {
  const out: DomainDetachResult[] = [];
  for (const domain of domains) {
    if (!domain.railwayDomainId) {
      out.push({ hostname: domain.hostname, ok: true });
      continue;
    }
    if (!railway) {
      out.push({ hostname: domain.hostname, ok: false, error: "Railway is not configured. Remove it from the Railway service by hand." });
      continue;
    }
    try {
      await railway.deleteDomain(domain.railwayDomainId);
      out.push({ hostname: domain.hostname, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      out.push({ hostname: domain.hostname, ok: /not found|does not exist/i.test(message), error: message });
    }
  }
  clearCustomHostCache();
  for (const row of out) {
    if (!row.ok) console.error(JSON.stringify({ msg: "purge: domain not detached from Railway", host: row.hostname, error: row.error }));
  }
  return out;
}
