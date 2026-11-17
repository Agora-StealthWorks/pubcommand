import { apexOf, relativeName } from "./hostname";
import type { DnsRecord } from "./status";

/** Railway's CustomDomain.status fields that describe the records to add. */
export type RailwayRecordsInput = {
  dnsRecords: { recordType: string; fqdn: string; hostlabel: string; zone: string; requiredValue: string; status: string; purpose: string }[];
  verificationDnsHost?: string | null;
  verificationToken?: string | null;
  verified: boolean;
};

const TYPE: Record<string, DnsRecord["type"]> = {
  DNS_RECORD_TYPE_CNAME: "CNAME",
  DNS_RECORD_TYPE_TXT: "TXT",
  DNS_RECORD_TYPE_A: "A",
};

/**
 * The records to show (and, on a Cloudflare zone, to create): Railway's traffic
 * record(s) plus the ownership TXT record, which Railway reports separately
 * from `dnsRecords` (verificationDnsHost + verificationToken).
 */
export function recordsFromRailway(hostname: string, input: RailwayRecordsInput): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const record of input.dnsRecords) {
    const type = TYPE[record.recordType];
    if (!type || !record.requiredValue) continue;
    const zone = record.zone || apexOf(hostname);
    const fqdn = (record.fqdn || (record.hostlabel ? `${record.hostlabel}.${zone}` : zone)).toLowerCase();
    out.push({
      type,
      fqdn,
      name: relativeName(fqdn, zone),
      value: record.requiredValue,
      purpose: record.purpose === "DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE" ? "certificate" : "traffic",
      ok: record.status === "DNS_RECORD_STATUS_PROPAGATED",
    });
  }
  if (input.verificationDnsHost && input.verificationToken) {
    const zone = apexOf(hostname);
    const host = input.verificationDnsHost.toLowerCase().replace(/\.$/, "");
    // Railway may return a full name or a label relative to the zone.
    const fqdn = host === zone || host.endsWith(`.${zone}`) ? host : `${host}.${zone}`;
    out.push({ type: "TXT", fqdn, name: relativeName(fqdn, zone), value: input.verificationToken, purpose: "verification", ok: input.verified });
  }
  return out;
}

/** Parses the `dns_records` JSON column defensively. */
export function parseStoredRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.fqdn !== "string" || typeof row.value !== "string" || typeof row.type !== "string") return [];
    return [{
      type: row.type as DnsRecord["type"],
      fqdn: row.fqdn,
      name: typeof row.name === "string" ? row.name : row.fqdn,
      value: row.value,
      purpose: (row.purpose as DnsRecord["purpose"]) ?? "traffic",
      ok: row.ok === true,
    }];
  });
}

/** "$10.46" for USD, otherwise "10.46 EUR". Prices arrive as strings to keep decimals exact. */
export function formatPrice(amount: string | number, currency: string): string {
  const value = typeof amount === "number" ? amount.toFixed(2) : amount;
  if (currency.toUpperCase() === "USD") return `$${value}`;
  return `${value} ${currency.toUpperCase()}`;
}

/** Same price, compared as cents, so "10.4" and "10.40" match. */
export function samePrice(a: string, b: string): boolean {
  const toCents = (value: string) => Math.round(Number.parseFloat(value) * 100);
  return Number.isFinite(toCents(a)) && toCents(a) === toCents(b);
}
