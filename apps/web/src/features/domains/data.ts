import { tenantDb } from "@pubcommand/db";
import { parseStoredRecords } from "../../../../../modules/settings/domains/records";
import { isSettling, type DnsRecord, type DomainStatus } from "../../../../../modules/settings/domains/status";

export { formatPrice } from "../../../../../modules/settings/domains/records";
export { normalizeHostname } from "../../../../../modules/settings/domains/hostname";

export type DomainRow = {
  id: string;
  hostname: string;
  targetPath: string;
  targetLabel: string | null;
  status: DomainStatus;
  provider: "CLOUDFLARE_PURCHASED" | "EXTERNAL";
  redirectToHost: string | null;
  managedDns: boolean;
  records: DnsRecord[];
  lastCheckedAt: Date | null;
  error: string | null;
  companions: DomainRow[];
};

/** The org's domains, with each www → apex redirect nested under its apex. */
export async function loadDomains(organizationId: string): Promise<{ rows: DomainRow[]; settling: boolean }> {
  const all = await tenantDb(organizationId).customDomain.findMany({ orderBy: [{ createdAt: "asc" }] });
  const mapped: DomainRow[] = all.map((row) => ({
    id: row.id,
    hostname: row.hostname,
    targetPath: row.targetPath,
    targetLabel: row.targetLabel,
    status: row.status as DomainStatus,
    provider: row.provider,
    redirectToHost: row.redirectToHost,
    managedDns: Boolean(row.cloudflareZoneId),
    records: parseStoredRecords(row.dnsRecords),
    lastCheckedAt: row.lastCheckedAt,
    error: row.error,
    companions: [],
  }));
  const byHost = new Map(mapped.map((row) => [row.hostname, row]));
  const rows: DomainRow[] = [];
  for (const row of mapped) {
    const parent = row.redirectToHost ? byHost.get(row.redirectToHost) : undefined;
    if (parent) parent.companions.push(row);
    else rows.push(row);
  }
  return { rows, settling: mapped.some((row) => isSettling(row.status)) };
}

export async function loadPurchases(organizationId: string) {
  return tenantDb(organizationId).domainPurchase.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
}

export function timeAgo(date: Date | null, now = new Date()): string {
  if (!date) return "never";
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}
