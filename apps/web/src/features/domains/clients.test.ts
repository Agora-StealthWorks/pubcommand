/**
 * Cloudflare Registrar/DNS and Railway clients against fixtures (./fixtures).
 * The Cloudflare shapes follow the Registrar API (beta) reference; the Railway
 * shapes follow the public GraphQL schema. Nothing here reaches a provider,
 * and nothing is ever bought.
 */
import { describe, expect, it, vi } from "vitest";
import { recordsFromRailway } from "../../../../../modules/settings/domains/records";
import { statusFromRailway } from "../../../../../modules/settings/domains/status";
import { CloudflareClient, CloudflareError, cloudflareFromEnv, type Fetch } from "./cloudflare";
import { domainsConfig } from "./config";
import { purchaseDomain, type LedgerFinish, type PaymentStep, type PurchaseLedger } from "./purchase";
import { RailwayClient, RailwayError, railwayFromEnv } from "./railway";
import check from "./fixtures/cloudflare-domain-check.json";
import search from "./fixtures/cloudflare-domain-search.json";
import registration from "./fixtures/cloudflare-registration.json";
import registration202 from "./fixtures/cloudflare-registration-202.json";
import cfError from "./fixtures/cloudflare-error.json";
import zones from "./fixtures/cloudflare-zones.json";
import railwayCreate from "./fixtures/railway-domain-create.json";
import railwayActive from "./fixtures/railway-domain-active.json";
import railwayError from "./fixtures/railway-error.json";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fakeFetch(routes: (call: Call) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetcher: Fetch = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    const reply = routes(call);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  };
  return { fetcher, calls };
}

const cf = (fetcher: Fetch, sandbox = false) => new CloudflareClient({ token: "cf-token", accountId: "acc123", sandbox, fetch: fetcher });

describe("Cloudflare Registrar client", () => {
  it("checks availability and price with the documented request", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: check }));
    const results = await cf(fetcher).checkDomains(["example-gazette.com", "taken-example.com", "fancy.com", "example.lol"]);
    expect(calls[0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/acc123/registrar/domain-check",
      method: "POST",
      body: { domains: ["example-gazette.com", "taken-example.com", "fancy.com", "example.lol"] },
      headers: { authorization: "Bearer cf-token" },
    });
    expect(results[0]).toEqual({ name: "example-gazette.com", registrable: true, tier: "standard", reason: null, pricing: { currency: "USD", registrationCost: "10.46", renewalCost: "10.46" } });
    expect(results[1]).toMatchObject({ registrable: false, reason: "domain_unavailable", pricing: null });
    expect(results[2]).toMatchObject({ tier: "premium" });
  });

  it("uses the sandbox path when CLOUDFLARE_REGISTRAR_SANDBOX=true", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: check }));
    const client = cloudflareFromEnv({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc123", CLOUDFLARE_REGISTRAR_SANDBOX: "true" }, fetcher);
    expect(client?.sandbox).toBe(true);
    await client!.checkDomains(["example-gazette.com"]);
    expect(calls[0]!.url).toContain("/accounts/acc123/registrar-sandbox/domain-check");
  });

  it("caps a check at 20 domains", async () => {
    const { fetcher } = fakeFetch(() => ({ body: check }));
    await expect(cf(fetcher).checkDomains(Array.from({ length: 21 }, (_, i) => `d${i}.com`))).rejects.toBeInstanceOf(CloudflareError);
  });

  it("parses keyword suggestions", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: search }));
    const results = await cf(fetcher).searchDomains("gazette daily");
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/registrar/domain-search?q=gazette+daily&limit=10");
    expect(results.map((item) => item.name)).toEqual(["gazettedaily.com", "gazettedaily.dev", "gazette.com"]);
    expect(results[2]!.registrable).toBe(false);
  });

  it("registers synchronously, or reports a 202 workflow to poll", async () => {
    const sync = fakeFetch(() => ({ body: registration }));
    expect(await cf(sync.fetcher).registerDomain("example-gazette.com")).toMatchObject({ state: "registered", domain: "example-gazette.com", registrarStatus: "active" });
    expect(sync.calls[0]).toMatchObject({ url: expect.stringMatching(/\/registrar\/registrations$/), method: "POST", body: { domain_name: "example-gazette.com", auto_renew: true } });

    const later = fakeFetch(() => ({ status: 202, body: registration202 }));
    expect(await cf(later.fetcher).registerDomain("example-gazette.com")).toMatchObject({
      state: "pending",
      workflowUrl: expect.stringContaining("/workflow"),
    });
  });

  it("raises Cloudflare's error message", async () => {
    const { fetcher } = fakeFetch(() => ({ status: 403, body: cfError }));
    await expect(cf(fetcher).checkDomains(["a.com"])).rejects.toMatchObject({ message: "Authentication error", status: 403, code: 10000 });
  });

  it("creates DNS-only records, corrects wrong ones and skips correct ones", async () => {
    const existing: Record<string, unknown[]> = {
      "CNAME example-gazette.com": [{ id: "r1", type: "CNAME", name: "example-gazette.com", content: "old.up.railway.app", proxied: true }],
      "TXT _railway-verify.example-gazette.com": [{ id: "r2", type: "TXT", name: "_railway-verify.example-gazette.com", content: "\"railway-verify=4b1c0e5d\"", proxied: false }],
    };
    const { fetcher, calls } = fakeFetch((call) => {
      if (call.method === "GET") {
        const url = new URL(call.url);
        return { body: { success: true, result: existing[`${url.searchParams.get("type")} ${url.searchParams.get("name")}`] ?? [] } };
      }
      return { body: { success: true, result: { id: "new" } } };
    });
    const client = cf(fetcher);
    expect(await client.upsertDnsRecord("zone123", { type: "CNAME", name: "example-gazette.com", content: "k2l9x0ab.up.railway.app" })).toBe("updated");
    expect(await client.upsertDnsRecord("zone123", { type: "TXT", name: "_railway-verify.example-gazette.com", content: "railway-verify=4b1c0e5d" })).toBe("unchanged");
    expect(await client.upsertDnsRecord("zone123", { type: "CNAME", name: "www.example-gazette.com", content: "k2l9x0ab.up.railway.app" })).toBe("created");
    const writes = calls.filter((call) => call.method !== "GET");
    expect(writes.map((call) => [call.method, call.url.replace("https://api.cloudflare.com/client/v4", "")])).toEqual([
      ["PATCH", "/zones/zone123/dns_records/r1"],
      ["POST", "/zones/zone123/dns_records"],
    ]);
    for (const write of writes) expect(write.body).toMatchObject({ proxied: false, ttl: 1 });
  });

  it("finds the zone of a bought domain", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: zones }));
    expect(await cf(fetcher).ensureZone("example-gazette.com")).toBe("zone123");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/zones?name=example-gazette.com&account.id=acc123");
  });
});

const rw = (fetcher: Fetch) => new RailwayClient({ token: "rw-token", projectId: "p1", serviceId: "s1", environmentId: "e1", fetch: fetcher });

describe("Railway client", () => {
  it("creates a custom domain on the configured service", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: railwayCreate }));
    const domain = await rw(fetcher).createDomain("example-gazette.com");
    expect(calls[0]!.url).toBe("https://backboard.railway.com/graphql/v2");
    expect(calls[0]!.headers.authorization).toBe("Bearer rw-token");
    const body = calls[0]!.body as { query: string; variables: unknown };
    expect(body.query).toContain("customDomainCreate(input: $input)");
    expect(body.variables).toEqual({ input: { domain: "example-gazette.com", projectId: "p1", serviceId: "s1", environmentId: "e1" } });
    expect(domain.id).toBe("cd_7f3a");

    expect(statusFromRailway(domain.status)).toEqual({ status: "PENDING_DNS", error: null });
    expect(recordsFromRailway("example-gazette.com", domain.status)).toEqual([
      { type: "CNAME", fqdn: "example-gazette.com", name: "@", value: "k2l9x0ab.up.railway.app", purpose: "traffic", ok: false },
      { type: "TXT", fqdn: "_railway-verify.example-gazette.com", name: "_railway-verify", value: "railway-verify=4b1c0e5d", purpose: "verification", ok: false },
    ]);
  });

  it("reads the status and goes active once the certificate is valid", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: railwayActive }));
    const domain = await rw(fetcher).getDomain("cd_7f3a");
    expect((calls[0]!.body as { variables: unknown }).variables).toEqual({ id: "cd_7f3a", projectId: "p1" });
    expect(statusFromRailway(domain.status).status).toBe("ACTIVE");
  });

  it("raises GraphQL errors", async () => {
    const { fetcher } = fakeFetch(() => ({ body: railwayError }));
    await expect(rw(fetcher).getDomain("x")).rejects.toBeInstanceOf(RailwayError);
    await expect(rw(fetcher).getDomain("x")).rejects.toThrow("Problem processing request");
  });

  it("deletes and counts domains", async () => {
    const { fetcher, calls } = fakeFetch((call) =>
      (call.body as { query: string }).query.includes("customDomainDelete")
        ? { body: { data: { customDomainDelete: true } } }
        : { body: { data: { domains: { customDomains: [{ id: "a" }, { id: "b" }] } } } },
    );
    expect(await rw(fetcher).deleteDomain("cd_7f3a")).toBe(true);
    expect(await rw(fetcher).countCustomDomains()).toBe(2);
    expect((calls[1]!.body as { variables: unknown }).variables).toEqual({ projectId: "p1", serviceId: "s1", environmentId: "e1" });
  });

  it("is off until every variable is set", () => {
    expect(railwayFromEnv({ RAILWAY_API_TOKEN: "t", RAILWAY_PROJECT_ID: "p" })).toBeNull();
    const config = domainsConfig({ RAILWAY_API_TOKEN: "t", RAILWAY_PROJECT_ID: "p" } as NodeJS.ProcessEnv);
    expect(config.railway.missing.map((item) => item.name)).toEqual(["RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID"]);
    expect(config.cloudflare.missing.map((item) => item.name)).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  });
});

describe("purchaseDomain", () => {
  function setup(checkBody: unknown, registerReply: { status?: number; body: unknown } = { body: registration }) {
    const { fetcher, calls } = fakeFetch((call) => (call.url.endsWith("/domain-check") ? { body: checkBody } : registerReply));
    const events: string[] = [];
    const finishes: LedgerFinish[] = [];
    const ledger: PurchaseLedger = {
      async start() {
        events.push("start");
        return "purchase-1";
      },
      async finish(_id, update) {
        events.push(`finish:${update.result}`);
        finishes.push(update);
      },
    };
    const refund = vi.fn(async () => undefined);
    const payment: PaymentStep = {
      name: "test",
      charge: vi.fn(async () => {
        events.push("charge");
        return { ok: true as const, reference: "pay_1" };
      }),
      refund,
    };
    const input = { organizationId: "org", brandId: null, actorId: "user", domain: "example-gazette.com", quotedPrice: "10.46", quotedCurrency: "USD" };
    return { fetcher, calls, events, finishes, ledger, payment, refund, input };
  }
  const registered = (calls: Call[]) => calls.some((call) => call.url.endsWith("/registrations"));

  it("records, re-checks, charges, then registers", async () => {
    const t = setup(check);
    const outcome = await purchaseDomain(t.input, { registrar: cf(t.fetcher), payment: t.payment, ledger: t.ledger });
    expect(outcome).toEqual({ kind: "registered", purchaseId: "purchase-1", domain: "example-gazette.com" });
    expect(t.events).toEqual(["start", "charge", "finish:SUCCEEDED"]);
    expect(t.calls.map((call) => call.url.split("/").pop())).toEqual(["domain-check", "registrations"]);
    expect(t.finishes[0]).toMatchObject({ paymentReference: "pay_1", registrarStatus: "active" });
  });

  it("never buys when the price changed since the person confirmed", async () => {
    const t = setup(check);
    const outcome = await purchaseDomain({ ...t.input, quotedPrice: "9.99" }, { registrar: cf(t.fetcher), payment: t.payment, ledger: t.ledger });
    expect(outcome).toMatchObject({ kind: "refused", reason: expect.stringContaining("price changed to 10.46 USD") });
    expect(registered(t.calls)).toBe(false);
    expect(t.payment.charge).not.toHaveBeenCalled();
    expect(t.events).toEqual(["start", "finish:FAILED"]);
  });

  it("never buys taken or premium domains", async () => {
    for (const domain of ["taken-example.com", "fancy.com"]) {
      const t = setup(check);
      const outcome = await purchaseDomain({ ...t.input, domain }, { registrar: cf(t.fetcher), payment: t.payment, ledger: t.ledger });
      expect(outcome.kind, domain).toBe("refused");
      expect(registered(t.calls)).toBe(false);
    }
  });

  it("records a pending (202) registration", async () => {
    const t = setup(check, { status: 202, body: registration202 });
    const outcome = await purchaseDomain(t.input, { registrar: cf(t.fetcher), payment: t.payment, ledger: t.ledger });
    expect(outcome.kind).toBe("pending");
    expect(t.finishes[0]).toMatchObject({ result: "PENDING", workflowUrl: expect.stringContaining("/workflow") });
  });

  it("refunds the payment step and records the failure when the registrar fails", async () => {
    const t = setup(check, { status: 500, body: cfError });
    const outcome = await purchaseDomain(t.input, { registrar: cf(t.fetcher), payment: t.payment, ledger: t.ledger });
    expect(outcome).toMatchObject({ kind: "failed", reason: "Authentication error" });
    expect(t.refund).toHaveBeenCalledOnce();
    expect(t.events).toEqual(["start", "charge", "finish:FAILED"]);
  });

  it("stops when the payment step declines", async () => {
    const t = setup(check);
    const payment: PaymentStep = { name: "card", charge: async () => ({ ok: false, reason: "card declined" }) };
    const outcome = await purchaseDomain(t.input, { registrar: cf(t.fetcher), payment, ledger: t.ledger });
    expect(outcome).toMatchObject({ kind: "refused", reason: "Payment failed: card declined" });
    expect(registered(t.calls)).toBe(false);
  });
});
