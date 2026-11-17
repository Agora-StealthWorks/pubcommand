import { describe, expect, it } from "vitest";
import { manifest } from "../manifest";
import { apexOf, isPlatformHost, normalizeHostname, relativeName } from "./hostname";
import { formatPrice, recordsFromRailway, samePrice } from "./records";
import { decideCustomHost, joinPath, normalizeTargetPath, publicInternalPath } from "./routing";
import { shouldRecheck, statusAfterCheckFailure, statusFromRailway } from "./status";

const ROOT = "pubcommand.com";

describe("normalizeHostname", () => {
  it("cleans up what people paste", () => {
    expect(normalizeHostname("https://Shop.Example.com/path?x=1", ROOT)).toEqual({ ok: true, hostname: "shop.example.com", apex: "example.com", isApex: false });
    expect(normalizeHostname("  EXAMPLE.com.  ", ROOT)).toEqual({ ok: true, hostname: "example.com", apex: "example.com", isApex: true });
    expect(normalizeHostname("example.com:8443", ROOT)).toMatchObject({ ok: true, hostname: "example.com" });
  });

  it("converts international names to punycode", () => {
    expect(normalizeHostname("bücher.de", ROOT)).toMatchObject({ ok: true, hostname: "xn--bcher-kva.de" });
  });

  it("knows common two-level suffixes", () => {
    expect(normalizeHostname("example.co.uk", ROOT)).toMatchObject({ ok: true, isApex: true, apex: "example.co.uk" });
    expect(apexOf("www.example.co.uk")).toBe("example.co.uk");
    expect(apexOf("a.b.example.com")).toBe("example.com");
  });

  it("refuses invalid, platform, Railway, IP and wildcard hosts", () => {
    for (const bad of ["", "example", "exa_mple.com", "-bad.com", "bad-.com", "a..com", "example.c", "example.123", "user@example.com"]) {
      expect(normalizeHostname(bad, ROOT).ok, bad).toBe(false);
    }
    expect(normalizeHostname("1.2.3.4", ROOT)).toMatchObject({ ok: false, reason: expect.stringContaining("IP") });
    expect(normalizeHostname("*.example.com", ROOT)).toMatchObject({ ok: false, reason: expect.stringContaining("Wildcard") });
    expect(normalizeHostname("pubcommand.com", ROOT).ok).toBe(false);
    expect(normalizeHostname("acme.PubCommand.com", ROOT).ok).toBe(false);
    expect(normalizeHostname("acme.localhost", ROOT).ok).toBe(false);
    expect(normalizeHostname("web-production.up.railway.app", ROOT).ok).toBe(false);
    expect(normalizeHostname(`${"a".repeat(64)}.com`, ROOT).ok).toBe(false);
  });

  it("treats pubcommand.com and its subdomains as platform hosts", () => {
    expect(isPlatformHost("pubcommand.com", ROOT)).toBe(true);
    expect(isPlatformHost("x.y.pubcommand.com", ROOT)).toBe(true);
    expect(isPlatformHost("notpubcommand.com", ROOT)).toBe(false);
    expect(isPlatformHost("example.com", ROOT)).toBe(false);
  });

  it("names records relative to their zone", () => {
    expect(relativeName("example.com", "example.com")).toBe("@");
    expect(relativeName("www.example.com.", "example.com")).toBe("www");
    expect(relativeName("_railway-verify.shop.example.com", "example.com")).toBe("_railway-verify.shop");
  });
});

describe("normalizeTargetPath", () => {
  it("accepts public page paths", () => {
    expect(normalizeTargetPath("/f/my-form")).toEqual({ ok: true, path: "/f/my-form" });
    expect(normalizeTargetPath("l/my-launch/")).toEqual({ ok: true, path: "/l/my-launch" });
    expect(normalizeTargetPath("/T/my-site")).toEqual({ ok: true, path: "/t/my-site" });
    expect(normalizeTargetPath("https://acme.pubcommand.com/embed/x")).toEqual({ ok: true, path: "/embed/x" });
  });

  it("refuses app, api, token and malformed paths", () => {
    for (const bad of ["", "/", "/f", "/settings/users", "/api/health", "/sites/org/x", "/p/cub/r/token", "/f/../settings", "/f/x?y=1", "/f/a b"]) {
      expect(normalizeTargetPath(bad).ok, bad).toBe(false);
    }
  });
});

describe("custom host rewrite", () => {
  const base = { orgSlug: "acme", targetPath: "/f/survey" };

  it("joins paths without doubling slashes", () => {
    expect(joinPath("/l/launch", "/")).toBe("/l/launch");
    expect(joinPath("/l/launch/", "/day-2/")).toBe("/l/launch/day-2/");
    expect(joinPath("/t/site", "post")).toBe("/t/site/post");
  });

  it("serves the target at the root and joins other paths onto it", () => {
    expect(decideCustomHost({ ...base, pathname: "/" })).toEqual({ kind: "rewrite", pathname: "/sites/public/acme/f/survey", publicPath: "/f/survey" });
    expect(decideCustomHost({ orgSlug: "acme", targetPath: "/l/launch", pathname: "/day-2" })).toMatchObject({ pathname: "/sites/public/acme/l/launch/day-2" });
    expect(decideCustomHost({ orgSlug: "acme", targetPath: "/t/site", pathname: "/posts/hello" })).toMatchObject({ pathname: "/sites/public/acme/t/site/posts/hello" });
  });

  it("serves absolute public paths so links, submits and embeds work", () => {
    expect(decideCustomHost({ ...base, pathname: "/f/survey/submit" })).toMatchObject({ pathname: "/sites/public/acme/f/survey/submit" });
    expect(decideCustomHost({ ...base, pathname: "/f/survey/logo" })).toMatchObject({ pathname: "/sites/public/acme/f/survey/logo" });
    expect(decideCustomHost({ ...base, pathname: "/embed/other-form" })).toMatchObject({ pathname: "/sites/public/acme/embed/other-form" });
    expect(decideCustomHost({ ...base, pathname: "/p/cub/r/tok/draft" })).toMatchObject({ pathname: "/sites/public/acme/cub/r/tok/draft" });
    expect(publicInternalPath("acme", "/p")).toBe("/sites/public/acme");
  });

  it("refuses app, admin, auth and api paths on custom hosts", () => {
    for (const pathname of ["/api/health", "/api/auth/login", "/sites/org/acme/settings", "/login", "/logout", "/settings", "/settings/domains", "/admin", "/2fa", "/viewport/x", "/_next/data/x", "/API/health"]) {
      expect(decideCustomHost({ ...base, pathname }), pathname).toEqual({ kind: "not_found" });
    }
  });

  it("refuses traversal and malformed paths", () => {
    for (const pathname of ["/f/../settings", "//evil.com", "/a/./b", "/f\\x"]) {
      expect(decideCustomHost({ ...base, pathname }), pathname).toEqual({ kind: "not_found" });
    }
  });

  it("never rewrites into the signed-in app", () => {
    for (const pathname of ["/", "/promo-studio", "/forms", "/knowledge/x", "/f/x", "/t/s/p"]) {
      const decision = decideCustomHost({ ...base, pathname });
      expect(decision.kind).toBe("rewrite");
      if (decision.kind === "rewrite") expect(decision.pathname.startsWith("/sites/public/acme/")).toBe(true);
    }
  });

  it("serves Mini-Blogs at /b/ and keeps the old /t/ path working", () => {
    expect(normalizeTargetPath("/b/my-blog")).toEqual({ ok: true, path: "/b/my-blog" });
    expect(normalizeTargetPath("/t/my-blog")).toEqual({ ok: true, path: "/t/my-blog" });
    const blog = { orgSlug: "acme", targetPath: "/b/alerts" };
    expect(decideCustomHost({ ...blog, pathname: "/" })).toEqual({ kind: "rewrite", pathname: "/sites/public/acme/b/alerts", publicPath: "/b/alerts" });
    expect(decideCustomHost({ ...blog, pathname: "/big-news" })).toMatchObject({ pathname: "/sites/public/acme/b/alerts/big-news" });
    expect(decideCustomHost({ ...blog, pathname: "/subscribe/submit" })).toMatchObject({ pathname: "/sites/public/acme/b/alerts/subscribe/submit" });
    // Absolute links on either prefix are served as-is.
    expect(decideCustomHost({ ...blog, pathname: "/b/alerts/logo" })).toMatchObject({ pathname: "/sites/public/acme/b/alerts/logo" });
    expect(decideCustomHost({ ...blog, pathname: "/t/alerts/big-news" })).toMatchObject({ pathname: "/sites/public/acme/t/alerts/big-news" });
    // A domain saved before the rename still points at /t/.
    expect(decideCustomHost({ orgSlug: "acme", targetPath: "/t/alerts", pathname: "/subscribe" })).toMatchObject({ pathname: "/sites/public/acme/t/alerts/subscribe" });
  });

  it("refuses a stored target that is no longer valid", () => {
    expect(decideCustomHost({ orgSlug: "acme", targetPath: "/settings", pathname: "/" })).toEqual({ kind: "not_found" });
  });

  it("redirects www to the apex, keeping path and query", () => {
    expect(decideCustomHost({ ...base, pathname: "/f/survey", search: "?utm=x", redirectToHost: "example.com" })).toEqual({
      kind: "redirect",
      location: "https://example.com/f/survey?utm=x",
    });
  });
});

describe("status transitions", () => {
  const cname = { recordType: "DNS_RECORD_TYPE_CNAME", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" };

  it("waits for DNS until the CNAME propagates and ownership is verified", () => {
    expect(statusFromRailway({ verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP", dnsRecords: [{ ...cname, status: "DNS_RECORD_STATUS_REQUIRES_UPDATE" }] }).status).toBe("PENDING_DNS");
    expect(statusFromRailway({ verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP", dnsRecords: [{ ...cname, status: "DNS_RECORD_STATUS_PROPAGATED" }] }).status).toBe("PENDING_DNS");
    expect(statusFromRailway({ verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_UNSPECIFIED", dnsRecords: [] }).status).toBe("PENDING_DNS");
  });

  it("verifies while the certificate is issued, then goes active", () => {
    expect(statusFromRailway({ verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_ISSUING", dnsRecords: [{ ...cname, status: "DNS_RECORD_STATUS_PROPAGATED" }] }).status).toBe("VERIFYING");
    expect(statusFromRailway({ verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID", dnsRecords: [{ ...cname, status: "DNS_RECORD_STATUS_PROPAGATED" }] })).toEqual({ status: "ACTIVE", error: null });
  });

  it("reports certificate failures", () => {
    expect(statusFromRailway({ verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_ISSUE_FAILED", certificateErrorMessage: "CAA forbids", dnsRecords: [] })).toEqual({ status: "ERROR", error: "CAA forbids" });
  });

  it("keeps an active domain active when a check fails", () => {
    expect(statusAfterCheckFailure("ACTIVE", "timeout")).toEqual({ status: "ACTIVE", error: "Last check failed: timeout" });
    expect(statusAfterCheckFailure("PENDING_DNS", "timeout")).toEqual({ status: "ERROR", error: "timeout" });
  });

  it("re-checks on a schedule per status", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(shouldRecheck("PENDING_DNS", null, now)).toBe(true);
    expect(shouldRecheck("PENDING_DNS", new Date("2026-11-17T11:59:00Z"), now)).toBe(false);
    expect(shouldRecheck("PENDING_DNS", new Date("2026-11-17T11:57:00Z"), now)).toBe(true);
    expect(shouldRecheck("ACTIVE", new Date("2026-11-17T09:00:00Z"), now)).toBe(false);
  });
});

describe("records", () => {
  it("maps Railway records plus the ownership TXT record", () => {
    const records = recordsFromRailway("shop.example.com", {
      verified: false,
      verificationDnsHost: "_railway-verify.shop",
      verificationToken: "railway-verify=abc",
      dnsRecords: [
        { recordType: "DNS_RECORD_TYPE_CNAME", fqdn: "shop.example.com", hostlabel: "shop", zone: "example.com", requiredValue: "x1y2.up.railway.app", status: "DNS_RECORD_STATUS_REQUIRES_UPDATE", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" },
      ],
    });
    expect(records).toEqual([
      { type: "CNAME", fqdn: "shop.example.com", name: "shop", value: "x1y2.up.railway.app", purpose: "traffic", ok: false },
      { type: "TXT", fqdn: "_railway-verify.shop.example.com", name: "_railway-verify.shop", value: "railway-verify=abc", purpose: "verification", ok: false },
    ]);
  });

  it("formats and compares prices exactly", () => {
    expect(formatPrice("10.46", "usd")).toBe("$10.46");
    expect(formatPrice("9.00", "EUR")).toBe("9.00 EUR");
    expect(samePrice("10.4", "10.40")).toBe(true);
    expect(samePrice("10.46", "10.47")).toBe(false);
    expect(samePrice("abc", "abc")).toBe(false);
  });
});

describe("settings manifest", () => {
  it("declares domains.manage", () => {
    expect(manifest.permissions.map((permission) => permission.key)).toContain("domains.manage");
  });
});
