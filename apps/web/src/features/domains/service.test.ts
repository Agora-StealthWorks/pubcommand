import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { CloudflareClient, type Fetch } from "./cloudflare";
import { RailwayClient } from "./railway";
import { clearCustomHostCache, resolveCustomHost } from "./resolve";
import { changeTarget, checkDomain, connectDomain, removeDomain } from "./service";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

/** Fake Railway: remembers created domains; flips to ACTIVE when `activate` is set. */
function fakeRailway() {
  const state = { created: [] as string[], deleted: [] as string[], active: false, taken: new Set<string>() };
  const domainBody = (id: string, domain: string) => ({
    id,
    domain,
    status: {
      verified: state.active,
      certificateStatus: state.active ? "CERTIFICATE_STATUS_TYPE_VALID" : "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP",
      certificateErrorMessage: null,
      verificationDnsHost: `_railway-verify.${domain}`,
      verificationToken: `railway-verify=${id}`,
      dnsRecords: [
        {
          recordType: "DNS_RECORD_TYPE_CNAME",
          fqdn: domain,
          hostlabel: "",
          zone: domain.replace(/^www\./, ""),
          requiredValue: "abc123.up.railway.app",
          currentValue: state.active ? "abc123.up.railway.app" : "",
          status: state.active ? "DNS_RECORD_STATUS_PROPAGATED" : "DNS_RECORD_STATUS_REQUIRES_UPDATE",
          purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE",
        },
      ],
    },
  });
  const fetcher: Fetch = async (_url, init) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> & { input: { domain: string } } };
    let data: unknown;
    if (query.includes("customDomainAvailable")) data = { customDomainAvailable: { available: !state.taken.has(variables.domain), message: "Domain is taken" } };
    else if (query.includes("customDomainCreate")) {
      const id = `cd_${state.created.length + 1}`;
      state.created.push(variables.input.domain);
      data = { customDomainCreate: domainBody(id, variables.input.domain) };
    } else if (query.includes("customDomainDelete")) {
      state.deleted.push(variables.id);
      data = { customDomainDelete: true };
    } else data = { customDomain: domainBody(variables.id, "example.test") };
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return { state, client: new RailwayClient({ token: "t", projectId: "p", serviceId: "s", environmentId: "e", fetch: fetcher }) };
}

/** Fake Cloudflare DNS: one zone, records written to a list. */
function fakeCloudflare(zoneName: string) {
  const writes: { method: string; body: { proxied?: boolean } }[] = [];
  const fetcher: Fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes("/zones?")) {
      const name = new URL(url).searchParams.get("name");
      return Response.json({ success: true, result: name === zoneName ? [{ id: "zone-1", name: zoneName }] : [] });
    }
    if (method === "GET") return Response.json({ success: true, result: [] });
    writes.push({ method, body: JSON.parse(String(init?.body)) });
    return Response.json({ success: true, result: { id: "rec" } });
  };
  return { writes, client: new CloudflareClient({ token: "t", accountId: "acc", fetch: fetcher }) };
}

describe("custom domains (database)", () => {
  const db = rawPrisma();
  const suffix = randomBytes(4).toString("hex");
  const ids = { org: "", other: "", plan: "" };
  const apex = `gazette-${suffix}.test`;
  const base = { brandId: null, actorId: "00000000-0000-4000-8000-000000000001", targetLabel: null, provider: "EXTERNAL" as const, rootDomain: "pubcommand.com" };

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
      env: process.env,
      stdio: "ignore",
    });
    const plan = await db.plan.create({ data: { key: `domains-${suffix}`, name: "Domains test", seatLimit: 5, monthlyPriceCents: 0 } });
    const org = await db.organization.create({ data: { name: `Domains ${suffix}`, slug: `dom-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const other = await db.organization.create({ data: { name: `Other ${suffix}`, slug: `dom-other-${suffix}`, planId: plan.id, seatLimit: 5 } });
    Object.assign(ids, { org: org.id, other: other.id, plan: plan.id });
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [ids.org, ids.other] } } });
    await db.plan.deleteMany({ where: { id: ids.plan } });
  });

  it("connects an apex with a www redirect and creates DNS on a Cloudflare zone", async () => {
    const railway = fakeRailway();
    const cloudflare = fakeCloudflare(apex);
    const result = await connectDomain(
      { railway: railway.client, cloudflare: cloudflare.client },
      { ...base, organizationId: ids.org, hostname: `HTTPS://${apex.toUpperCase()}/`, targetPath: "f/survey", wwwRedirect: true },
    );
    expect(result).toMatchObject({ ok: true, hostnames: [apex, `www.${apex}`], warning: null });
    expect(railway.state.created).toEqual([apex, `www.${apex}`]);
    // CNAME + TXT for each host, DNS only.
    expect(cloudflare.writes).toHaveLength(4);
    expect(cloudflare.writes.every((write) => write.body.proxied === false)).toBe(true);

    const rows = await tenantDb(ids.org).customDomain.findMany({ orderBy: { hostname: "asc" } });
    expect(rows.map((row) => [row.hostname, row.targetPath, row.redirectToHost, row.status, row.cloudflareZoneId])).toEqual([
      [apex, "/f/survey", null, "PENDING_DNS", "zone-1"],
      [`www.${apex}`, "/f/survey", apex, "PENDING_DNS", "zone-1"],
    ]);

    clearCustomHostCache();
    expect(await resolveCustomHost(apex)).toMatchObject({ orgSlug: `dom-${suffix}`, targetPath: "/f/survey", redirectToHost: null });
    expect(await resolveCustomHost(`www.${apex}`)).toMatchObject({ redirectToHost: apex });
    expect(await resolveCustomHost(`nope-${suffix}.test`)).toBeNull();
  });

  it("keeps hostnames unique across organizations and tenant-isolated", async () => {
    const railway = fakeRailway();
    const result = await connectDomain({ railway: railway.client, cloudflare: null }, { ...base, organizationId: ids.other, hostname: apex, targetPath: "/f/x", wwwRedirect: false });
    expect(result).toEqual({ ok: false, error: `${apex} is connected to another organization.` });
    expect(railway.state.created).toEqual([]);
    expect(await tenantDb(ids.other).customDomain.count()).toBe(0);
  });

  it("refuses bad hosts and app paths before calling Railway", async () => {
    const railway = fakeRailway();
    const providers = { railway: railway.client, cloudflare: null };
    expect(await connectDomain(providers, { ...base, organizationId: ids.org, hostname: "acme.pubcommand.com", targetPath: "/f/x", wwwRedirect: false })).toMatchObject({ ok: false });
    expect(await connectDomain(providers, { ...base, organizationId: ids.org, hostname: `x-${suffix}.test`, targetPath: "/settings", wwwRedirect: false })).toMatchObject({ ok: false });
    expect(await connectDomain({ railway: null, cloudflare: null }, { ...base, organizationId: ids.org, hostname: `x-${suffix}.test`, targetPath: "/f/x", wwwRedirect: false })).toMatchObject({ ok: false, error: expect.stringContaining("Railway is not configured") });
    railway.state.taken.add(`taken-${suffix}.test`);
    expect(await connectDomain(providers, { ...base, organizationId: ids.org, hostname: `taken-${suffix}.test`, targetPath: "/f/x", wwwRedirect: false })).toEqual({ ok: false, error: "Domain is taken" });
    expect(railway.state.created).toEqual([]);
  });

  it("moves to ACTIVE on check, changes the target for both hosts, and removes both", async () => {
    const railway = fakeRailway();
    railway.state.active = true;
    const providers = { railway: railway.client, cloudflare: null };
    const row = await tenantDb(ids.org).customDomain.findFirst({ where: { hostname: apex } });
    const checked = await checkDomain(providers, ids.org, row!.id);
    expect(checked).toEqual({ ok: true, status: "ACTIVE", changed: true, from: "PENDING_DNS" });

    expect(await changeTarget(ids.org, row!.id, "/l/launch", null)).toMatchObject({ ok: true, to: "/l/launch" });
    const targets = await tenantDb(ids.org).customDomain.findMany({ select: { targetPath: true } });
    expect(targets.every((item) => item.targetPath === "/l/launch")).toBe(true);
    // Another org cannot touch it.
    expect(await checkDomain(providers, ids.other, row!.id)).toEqual({ ok: false, error: "That domain is not connected." });
    expect(await removeDomain(providers, ids.other, row!.id)).toEqual({ ok: false, error: "That domain is not connected." });

    const removed = await removeDomain(providers, ids.org, row!.id);
    expect(removed).toEqual({ ok: true, hostnames: [apex, `www.${apex}`] });
    expect(railway.state.deleted).toHaveLength(2);
    expect(await tenantDb(ids.org).customDomain.count()).toBe(0);
    expect(await resolveCustomHost(apex)).toBeNull();
  });
});
