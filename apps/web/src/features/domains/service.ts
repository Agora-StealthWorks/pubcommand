/**
 * Connect, check and remove custom domains. Server only. Providers are passed
 * in (built from env by the caller) so the flow is testable against fixtures.
 */

import { Prisma, rawPrisma, tenantDb } from "@pubcommand/db";
import { normalizeHostname, wwwOf } from "../../../../../modules/settings/domains/hostname";
import { parseStoredRecords, recordsFromRailway } from "../../../../../modules/settings/domains/records";
import { normalizeTargetPath } from "../../../../../modules/settings/domains/routing";
import {
  shouldRecheck,
  statusAfterCheckFailure,
  statusFromRailway,
  type DnsRecord,
  type DomainStatus,
} from "../../../../../modules/settings/domains/status";
import type { CloudflareClient } from "./cloudflare";
import type { RailwayClient, RailwayDomain } from "./railway";
import { clearCustomHostCache } from "./resolve";

export type Providers = { railway: RailwayClient | null; cloudflare: CloudflareClient | null };

export type ConnectInput = {
  organizationId: string;
  brandId: string | null;
  actorId: string;
  hostname: string;
  targetPath: string;
  targetLabel: string | null;
  /** Apex only: also connect www.<apex> and redirect it to the apex. */
  wwwRedirect: boolean;
  provider: "CLOUDFLARE_PURCHASED" | "EXTERNAL";
  rootDomain: string;
};

export type ConnectResult =
  | { ok: true; ids: string[]; hostnames: string[]; warning: string | null }
  | { ok: false; error: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Who holds a hostname, across all organizations (hostname is platform-unique). */
async function hostnameOwner(hostname: string): Promise<string | null> {
  const rows = await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.$queryRaw<{ organization_id: string }[]>`SELECT organization_id FROM custom_domains WHERE hostname = ${hostname} LIMIT 1`;
  });
  return rows[0]?.organization_id ?? null;
}

/** Writes Railway's records into the Cloudflare zone (DNS only, never proxied). */
async function applyCloudflareRecords(cloudflare: CloudflareClient, zoneId: string, records: DnsRecord[]): Promise<void> {
  for (const record of records) {
    if (record.purpose === "certificate") continue;
    await cloudflare.upsertDnsRecord(zoneId, { type: record.type, name: record.fqdn, content: record.value });
  }
}

/** The Cloudflare zone for this host's apex, if it is on our Cloudflare account. */
async function zoneFor(cloudflare: CloudflareClient | null, apex: string): Promise<string | null> {
  if (!cloudflare) return null;
  try {
    return (await cloudflare.findZone(apex))?.id ?? null;
  } catch {
    return null;
  }
}

function snapshotState(hostname: string, domain: RailwayDomain) {
  const records = recordsFromRailway(hostname, domain.status);
  const decision = statusFromRailway(domain.status);
  return { records, ...decision };
}

async function connectOne(
  providers: Providers & { railway: RailwayClient },
  input: ConnectInput,
  hostname: string,
  apex: string,
  targetPath: string,
  redirectToHost: string | null,
): Promise<{ id: string; warning: string | null }> {
  const { railway, cloudflare } = providers;
  const available = await railway.isAvailable(hostname);
  if (!available.available) throw new Error(available.message || `${hostname} is already used on Railway.`);
  const domain = await railway.createDomain(hostname);
  const { records, status, error } = snapshotState(hostname, domain);
  let warning: string | null = null;

  const zoneId = await zoneFor(cloudflare, apex);
  if (cloudflare && zoneId) {
    try {
      await applyCloudflareRecords(cloudflare, zoneId, records);
    } catch (dnsError) {
      warning = `Connected, but the DNS records could not be created automatically: ${message(dnsError)} Add them by hand.`;
    }
  }

  try {
    const row = await tenantDb(input.organizationId).customDomain.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        hostname,
        targetPath,
        targetLabel: input.targetLabel,
        provider: input.provider,
        redirectToHost,
        railwayDomainId: domain.id,
        cloudflareZoneId: zoneId,
        dnsRecords: records as unknown as Prisma.InputJsonValue,
        status: status as DomainStatus,
        error: error ?? warning,
        lastCheckedAt: new Date(),
        createdById: input.actorId,
      },
      select: { id: true },
    });
    return { id: row.id, warning };
  } catch (dbError) {
    // Never leave an orphan on Railway: it would count against the plan's domain limit.
    await railway.deleteDomain(domain.id).catch(() => undefined);
    if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === "P2002") {
      throw new Error(`${hostname} is already connected.`);
    }
    throw dbError;
  }
}

export async function connectDomain(providers: Providers, input: ConnectInput): Promise<ConnectResult> {
  if (!providers.railway) return { ok: false, error: "Railway is not configured, so domains cannot be connected yet." };
  const host = normalizeHostname(input.hostname, input.rootDomain);
  if (!host.ok) return { ok: false, error: host.reason };
  const target = normalizeTargetPath(input.targetPath);
  if (!target.ok) return { ok: false, error: target.reason };
  const wanted = [host.hostname, ...(input.wwwRedirect && host.isApex ? [wwwOf(host.hostname)] : [])];
  for (const name of wanted) {
    const owner = await hostnameOwner(name);
    if (owner) {
      return { ok: false, error: owner === input.organizationId ? `${name} is already connected.` : `${name} is connected to another organization.` };
    }
  }
  const railwayProviders = { ...providers, railway: providers.railway };
  let primary: { id: string; warning: string | null };
  try {
    primary = await connectOne(railwayProviders, input, host.hostname, host.apex, target.path, null);
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  const ids = [primary.id];
  const hostnames = [host.hostname];
  let warning = primary.warning;
  if (wanted.length > 1) {
    try {
      const www = await connectOne(railwayProviders, input, wanted[1]!, host.apex, target.path, host.hostname);
      ids.push(www.id);
      hostnames.push(wanted[1]!);
      warning = warning ?? www.warning;
    } catch (error) {
      warning = `${host.hostname} is connected, but ${wanted[1]} could not be added: ${message(error)}`;
    }
  }
  clearCustomHostCache();
  return { ok: true, ids, hostnames, warning };
}

export type CheckResult = { ok: true; status: DomainStatus; changed: boolean; from: DomainStatus } | { ok: false; error: string };

/** Re-reads Railway's status (and re-applies Cloudflare records if they drifted). */
export async function checkDomain(providers: Providers, organizationId: string, id: string): Promise<CheckResult> {
  const db = tenantDb(organizationId);
  const row = await db.customDomain.findFirst({ where: { id } });
  if (!row) return { ok: false, error: "That domain is not connected." };
  const from = row.status as DomainStatus;
  if (!providers.railway || !row.railwayDomainId) {
    const error = !providers.railway ? "Railway is not configured." : "This domain was never added to Railway. Remove it and connect it again.";
    await db.customDomain.updateMany({ where: { id }, data: { lastCheckedAt: new Date(), error } });
    return { ok: false, error };
  }
  let next: { status: DomainStatus; error: string | null };
  let records = parseStoredRecords(row.dnsRecords);
  try {
    const domain = await providers.railway.getDomain(row.railwayDomainId);
    const snapshot = snapshotState(row.hostname, domain);
    records = snapshot.records;
    next = { status: snapshot.status, error: snapshot.error };
    if (providers.cloudflare && row.cloudflareZoneId && records.some((record) => !record.ok && record.purpose !== "certificate")) {
      try {
        await applyCloudflareRecords(providers.cloudflare, row.cloudflareZoneId, records);
      } catch (dnsError) {
        next.error = next.error ?? `Could not update DNS on Cloudflare: ${message(dnsError)}`;
      }
    }
  } catch (error) {
    next = statusAfterCheckFailure(from, message(error));
  }
  await db.customDomain.updateMany({
    where: { id },
    data: { status: next.status, error: next.error, dnsRecords: records as unknown as Prisma.InputJsonValue, lastCheckedAt: new Date() },
  });
  return { ok: true, status: next.status, changed: next.status !== from, from };
}

export type RemoveResult = { ok: true; hostnames: string[] } | { ok: false; error: string };

/** Removes the domain (and its www companion) from Railway, then from our database. */
export async function removeDomain(providers: Providers, organizationId: string, id: string): Promise<RemoveResult> {
  const db = tenantDb(organizationId);
  const row = await db.customDomain.findFirst({ where: { id } });
  if (!row) return { ok: false, error: "That domain is not connected." };
  const companions = await db.customDomain.findMany({ where: { redirectToHost: row.hostname } });
  const rows = [row, ...companions];
  for (const item of rows) {
    if (!item.railwayDomainId) continue;
    if (!providers.railway) return { ok: false, error: "Railway is not configured, so the domain cannot be removed from the service." };
    try {
      await providers.railway.deleteDomain(item.railwayDomainId);
    } catch (error) {
      // Already gone on Railway is fine; anything else stops the removal.
      if (!/not found|does not exist/i.test(message(error))) return { ok: false, error: `Railway refused: ${message(error)}` };
    }
  }
  await db.customDomain.deleteMany({ where: { id: { in: rows.map((item) => item.id) } } });
  clearCustomHostCache();
  return { ok: true, hostnames: rows.map((item) => item.hostname) };
}

export async function changeTarget(organizationId: string, id: string, targetPath: string, targetLabel: string | null) {
  const target = normalizeTargetPath(targetPath);
  if (!target.ok) return { ok: false as const, error: target.reason };
  const db = tenantDb(organizationId);
  const row = await db.customDomain.findFirst({ where: { id } });
  if (!row) return { ok: false as const, error: "That domain is not connected." };
  await db.customDomain.updateMany({
    where: { OR: [{ id }, { redirectToHost: row.hostname }] },
    data: { targetPath: target.path, targetLabel },
  });
  clearCustomHostCache();
  return { ok: true as const, hostname: row.hostname, from: row.targetPath, to: target.path };
}

/** Background re-check of one org's domains that are due (page views kick this off with after()). */
export async function recheckDue(providers: Providers, organizationId: string, now = new Date()): Promise<number> {
  if (!providers.railway) return 0;
  const rows = await tenantDb(organizationId).customDomain.findMany({ select: { id: true, status: true, lastCheckedAt: true } });
  let checked = 0;
  for (const row of rows) {
    if (!shouldRecheck(row.status as DomainStatus, row.lastCheckedAt, now)) continue;
    await checkDomain(providers, organizationId, row.id);
    checked += 1;
  }
  return checked;
}

/** Every organization with a domain due for a check (for the cron route). */
export async function organizationsWithDomains(): Promise<string[]> {
  const rows = await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.$queryRaw<{ organization_id: string }[]>`SELECT DISTINCT organization_id FROM custom_domains`;
  });
  return rows.map((row) => row.organization_id);
}
