/**
 * Cloudflare Registrar (beta, 2026-04) and DNS API client.
 *
 * Registrar endpoints, all under /accounts/{account_id}:
 *   GET  /registrar/domain-search?q=…   suggestions with cached, NON-authoritative pricing
 *   POST /registrar/domain-check        { domains: [fqdn…] } (≤20), authoritative registry check
 *   POST /registrar/registrations       { domain_name, auto_renew } → 200/201, or 202 + workflow to poll
 * The sandbox (CLOUDFLARE_REGISTRAR_SANDBOX=true) uses /registrar-sandbox/… and only
 * supports .com and .net. It never charges.
 *
 * DNS endpoints: GET/POST /zones, GET/POST/PATCH /zones/{zone_id}/dns_records.
 *
 * Every response is the v4 envelope { success, errors, result }. Parsing is
 * defensive because the Registrar API is in beta; unknown fields are ignored.
 * `fetch` is injected so tests run against recorded fixtures.
 */

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "CloudflareError";
  }
}

export type DomainPricing = { currency: string; registrationCost: string; renewalCost: string };

export type DomainCheck = {
  name: string;
  registrable: boolean;
  tier: string | null;
  reason: string | null;
  pricing: DomainPricing | null;
};

export type DomainSuggestion = { name: string; registrable: boolean; pricing: DomainPricing | null };

export type Registration =
  | { state: "registered"; domain: string; registrarStatus: string | null; raw: unknown }
  | { state: "pending"; domain: string; registrarStatus: string | null; workflowUrl: string | null; raw: unknown };

export type CloudflareDnsRecord = { id: string; type: string; name: string; content: string; proxied: boolean };

type Envelope = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: unknown };

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parsePricing(value: unknown): DomainPricing | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const registrationCost = asString(row.registration_cost);
  const currency = asString(row.currency);
  if (!registrationCost || !currency) return null;
  return { currency: currency.toUpperCase(), registrationCost, renewalCost: asString(row.renewal_cost) ?? registrationCost };
}

function domainsOf(result: unknown): Record<string, unknown>[] {
  const list = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Array.isArray((result as { domains?: unknown }).domains)
      ? (result as { domains: unknown[] }).domains
      : [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export class CloudflareClient {
  private readonly fetcher: Fetch;
  constructor(
    private readonly options: { token: string; accountId: string; sandbox?: boolean; fetch?: Fetch; baseUrl?: string },
  ) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get sandbox(): boolean {
    return Boolean(this.options.sandbox);
  }

  private registrarPath(path: string): string {
    const segment = this.options.sandbox ? "registrar-sandbox" : "registrar";
    return `/accounts/${encodeURIComponent(this.options.accountId)}/${segment}${path}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; envelope: Envelope; headers: Headers }> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl ?? CLOUDFLARE_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new CloudflareError(`Could not reach Cloudflare (${error instanceof Error ? error.message : "network error"}).`, 0);
    }
    let envelope: Envelope = {};
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      envelope = {};
    }
    if (!response.ok || envelope.success === false) {
      const first = envelope.errors?.[0];
      throw new CloudflareError(first?.message?.trim() || `Cloudflare returned HTTP ${response.status}.`, response.status, first?.code);
    }
    return { status: response.status, envelope, headers: response.headers };
  }

  /** Keyword suggestions. Cached data: always run checkDomains before buying. */
  async searchDomains(query: string, limit = 10): Promise<DomainSuggestion[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const { envelope } = await this.request("GET", `${this.registrarPath("/domain-search")}?${params}`);
    return domainsOf(envelope.result).flatMap((row) => {
      const name = asString(row.name);
      if (!name) return [];
      return [{ name: name.toLowerCase(), registrable: row.registrable === true, pricing: parsePricing(row.pricing) }];
    });
  }

  /** Authoritative availability and price, straight from the registry. */
  async checkDomains(domains: string[]): Promise<DomainCheck[]> {
    if (domains.length === 0) return [];
    if (domains.length > 20) throw new CloudflareError("Check at most 20 domains at a time.", 400);
    const { envelope } = await this.request("POST", this.registrarPath("/domain-check"), { domains });
    return domainsOf(envelope.result).flatMap((row) => {
      const name = asString(row.name);
      if (!name) return [];
      const registrable = row.registrable === true;
      return [{
        name: name.toLowerCase(),
        registrable,
        tier: asString(row.tier),
        reason: asString(row.reason),
        pricing: registrable ? parsePricing(row.pricing) : null,
      }];
    });
  }

  /** Registers (buys) a domain. Non-refundable. Only purchase.ts calls this. */
  async registerDomain(domain: string): Promise<Registration> {
    const { status, envelope, headers } = await this.request("POST", this.registrarPath("/registrations"), {
      domain_name: domain,
      auto_renew: true,
    });
    const result = (envelope.result && typeof envelope.result === "object" ? envelope.result : {}) as Record<string, unknown>;
    const registrarStatus = asString(result.status) ?? asString(result.state);
    const name = (asString(result.domain_name) ?? asString(result.name) ?? domain).toLowerCase();
    const workflowUrl = asString(result.workflow_url) ?? asString(result.url) ?? headers.get("location");
    const pending = status === 202 || /pending|progress|queued/i.test(registrarStatus ?? "");
    if (pending) return { state: "pending", domain: name, registrarStatus, workflowUrl, raw: envelope.result ?? null };
    return { state: "registered", domain: name, registrarStatus, raw: envelope.result ?? null };
  }

  /** Polls a 202 registration workflow URL returned by registerDomain. */
  async registrationWorkflow(workflowUrl: string): Promise<{ done: boolean; failed: boolean; status: string | null; raw: unknown }> {
    const base = this.options.baseUrl ?? CLOUDFLARE_API;
    const path = workflowUrl.startsWith(base) ? workflowUrl.slice(base.length) : workflowUrl.startsWith("/") ? workflowUrl : null;
    if (!path) throw new CloudflareError("Unexpected workflow URL from Cloudflare.", 0);
    const { envelope } = await this.request("GET", path);
    const result = (envelope.result && typeof envelope.result === "object" ? envelope.result : {}) as Record<string, unknown>;
    const status = asString(result.status) ?? asString(result.state);
    const failed = /fail|error|cancel/i.test(status ?? "");
    const done = failed || /complete|success|active|registered|done/i.test(status ?? "");
    return { done, failed, status, raw: envelope.result ?? null };
  }

  async findZone(name: string): Promise<{ id: string; status: string | null } | null> {
    const params = new URLSearchParams({ name, "account.id": this.options.accountId });
    const { envelope } = await this.request("GET", `/zones?${params}`);
    const zones = Array.isArray(envelope.result) ? (envelope.result as Record<string, unknown>[]) : [];
    const zone = zones.find((item) => asString(item.name)?.toLowerCase() === name.toLowerCase());
    const id = zone ? asString(zone.id) : null;
    return id ? { id, status: asString(zone?.status) } : null;
  }

  /** Registrar domains normally get a zone automatically; create one if not. */
  async ensureZone(name: string): Promise<string> {
    const found = await this.findZone(name);
    if (found) return found.id;
    const { envelope } = await this.request("POST", "/zones", { name, account: { id: this.options.accountId }, type: "full" });
    const id = asString((envelope.result as Record<string, unknown> | undefined)?.id);
    if (!id) throw new CloudflareError("Cloudflare did not return a zone id.", 0);
    return id;
  }

  async listDnsRecords(zoneId: string, filter: { type: string; name: string }): Promise<CloudflareDnsRecord[]> {
    const params = new URLSearchParams({ type: filter.type, name: filter.name });
    const { envelope } = await this.request("GET", `/zones/${encodeURIComponent(zoneId)}/dns_records?${params}`);
    const rows = Array.isArray(envelope.result) ? (envelope.result as Record<string, unknown>[]) : [];
    return rows.flatMap((row) => {
      const id = asString(row.id);
      if (!id) return [];
      return [{ id, type: asString(row.type) ?? "", name: asString(row.name) ?? "", content: asString(row.content) ?? "", proxied: row.proxied === true }];
    });
  }

  /**
   * Creates the record, or corrects an existing one with the same type and name.
   * Always DNS-only (proxied: false) so Railway can see the traffic and issue the
   * certificate. Returns what changed.
   */
  async upsertDnsRecord(zoneId: string, record: { type: string; name: string; content: string }): Promise<"created" | "updated" | "unchanged"> {
    const body = { type: record.type, name: record.name, content: record.content, ttl: 1, proxied: false };
    const existing = await this.listDnsRecords(zoneId, { type: record.type, name: record.name });
    const same = existing.find((row) => row.content.replace(/^"|"$/g, "") === record.content && !row.proxied);
    if (same) return "unchanged";
    // TXT names can hold several values; only CNAME/A are replaced in place.
    const replace = record.type === "TXT" ? null : existing[0];
    if (replace) {
      await this.request("PATCH", `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(replace.id)}`, body);
      return "updated";
    }
    await this.request("POST", `/zones/${encodeURIComponent(zoneId)}/dns_records`, body);
    return "created";
  }
}

export function cloudflareFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher?: Fetch): CloudflareClient | null {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) return null;
  return new CloudflareClient({ token, accountId, sandbox: env.CLOUDFLARE_REGISTRAR_SANDBOX === "true", fetch: fetcher });
}
