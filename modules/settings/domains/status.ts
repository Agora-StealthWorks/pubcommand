/**
 * Custom-domain status, derived from what Railway reports. Pure.
 *
 * PENDING_DNS → the records are not in place yet (CNAME missing/wrong, or the
 *               ownership TXT record not seen).
 * VERIFYING   → DNS is right; Railway is validating and issuing the certificate.
 * ACTIVE      → certificate issued; the domain serves over HTTPS.
 * ERROR       → certificate issuance failed, Railway refused the domain, or a
 *               provider call failed. A later check can move it back.
 */

export const DOMAIN_STATUSES = ["PENDING_DNS", "VERIFYING", "ACTIVE", "ERROR"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const STATUS_LABELS: Record<DomainStatus, string> = {
  PENDING_DNS: "Waiting for DNS",
  VERIFYING: "Verifying",
  ACTIVE: "Active",
  ERROR: "Error",
};

export type DnsRecord = {
  type: "CNAME" | "TXT" | "A";
  /** Fully qualified name, e.g. www.example.com or _railway-verify.example.com. */
  fqdn: string;
  /** Name relative to the zone ("@" for the apex), as typed into a DNS panel. */
  name: string;
  value: string;
  purpose: "traffic" | "verification" | "certificate";
  /** Whether the provider sees this record with the right value. */
  ok: boolean;
};

/** The subset of Railway's CustomDomain.status we act on. */
export type RailwayDomainSnapshot = {
  verified: boolean;
  certificateStatus: string;
  certificateErrorMessage?: string | null;
  dnsRecords: { recordType: string; status: string; purpose: string }[];
};

export type StatusDecision = { status: DomainStatus; error: string | null };

/** Maps a Railway snapshot onto our status. */
export function statusFromRailway(snapshot: RailwayDomainSnapshot): StatusDecision {
  const cert = snapshot.certificateStatus;
  if (cert === "CERTIFICATE_STATUS_TYPE_ISSUE_FAILED") {
    return { status: "ERROR", error: snapshot.certificateErrorMessage?.trim() || "Railway could not issue the certificate." };
  }
  const traffic = snapshot.dnsRecords.filter((record) => record.purpose !== "DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE");
  const dnsReady = traffic.length > 0 && traffic.every((record) => record.status === "DNS_RECORD_STATUS_PROPAGATED");
  if (cert === "CERTIFICATE_STATUS_TYPE_VALID" && snapshot.verified) return { status: "ACTIVE", error: null };
  if (!dnsReady || !snapshot.verified) return { status: "PENDING_DNS", error: null };
  return { status: "VERIFYING", error: null };
}

/** A failed provider call: keep a working domain ACTIVE (it still serves), otherwise show the error. */
export function statusAfterCheckFailure(current: DomainStatus, message: string): StatusDecision {
  if (current === "ACTIVE") return { status: "ACTIVE", error: `Last check failed: ${message}` };
  return { status: "ERROR", error: message };
}

/** Minimum time between automatic re-checks for each status. */
export const RECHECK_AFTER_MS: Record<DomainStatus, number> = {
  PENDING_DNS: 2 * 60_000,
  VERIFYING: 60_000,
  ERROR: 15 * 60_000,
  ACTIVE: 6 * 60 * 60_000,
};

export function shouldRecheck(status: DomainStatus, lastCheckedAt: Date | null, now: Date): boolean {
  if (!lastCheckedAt) return true;
  return now.getTime() - lastCheckedAt.getTime() >= RECHECK_AFTER_MS[status];
}

/** True while the page should keep polling for changes. */
export function isSettling(status: DomainStatus): boolean {
  return status === "PENDING_DNS" || status === "VERIFYING";
}
