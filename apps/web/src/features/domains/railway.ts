/**
 * Railway public GraphQL API client for custom domains on the pubcommand service.
 * Endpoint: https://backboard.railway.com/graphql/v2, `Authorization: Bearer <account or workspace token>`.
 *
 * Schema used (from Railway's public schema):
 *   customDomainAvailable(domain: String!): DomainAvailable! { available message }
 *   customDomainCreate(input: { domain, environmentId, projectId, serviceId, targetPort? }): CustomDomain!
 *   customDomain(id: String!, projectId: String!): CustomDomain!
 *   customDomainDelete(id: String!): Boolean!
 *   domains(environmentId, projectId, serviceId): AllDomains! { customDomains serviceDomains }
 *   CustomDomain.status: { dnsRecords { recordType fqdn hostlabel zone requiredValue currentValue status purpose }
 *                          verificationDnsHost verificationToken verified certificateStatus certificateErrorMessage }
 *
 * Limits: custom domains per service are capped by the Railway plan (Hobby 2,
 * Pro 20 by default, raised only on request). A wildcard counts as one.
 */

import type { Fetch } from "./cloudflare";

export const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

export class RailwayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RailwayError";
  }
}

export type RailwayDomain = {
  id: string;
  domain: string;
  status: {
    verified: boolean;
    certificateStatus: string;
    certificateErrorMessage: string | null;
    verificationDnsHost: string | null;
    verificationToken: string | null;
    dnsRecords: { recordType: string; fqdn: string; hostlabel: string; zone: string; requiredValue: string; currentValue: string; status: string; purpose: string }[];
  };
};

const DOMAIN_FIELDS = `
  id
  domain
  status {
    verified
    certificateStatus
    certificateErrorMessage
    verificationDnsHost
    verificationToken
    dnsRecords { recordType fqdn hostlabel zone requiredValue currentValue status purpose }
  }
`;

function toDomain(value: unknown): RailwayDomain {
  const row = (value ?? {}) as Record<string, unknown>;
  const status = (row.status ?? {}) as Record<string, unknown>;
  const records = Array.isArray(status.dnsRecords) ? (status.dnsRecords as Record<string, unknown>[]) : [];
  const text = (input: unknown) => (typeof input === "string" ? input : "");
  if (typeof row.id !== "string") throw new RailwayError("Railway did not return a domain id.", 0);
  return {
    id: row.id,
    domain: text(row.domain),
    status: {
      verified: status.verified === true,
      certificateStatus: text(status.certificateStatus) || "CERTIFICATE_STATUS_TYPE_UNSPECIFIED",
      certificateErrorMessage: typeof status.certificateErrorMessage === "string" ? status.certificateErrorMessage : null,
      verificationDnsHost: typeof status.verificationDnsHost === "string" ? status.verificationDnsHost : null,
      verificationToken: typeof status.verificationToken === "string" ? status.verificationToken : null,
      dnsRecords: records.map((record) => ({
        recordType: text(record.recordType),
        fqdn: text(record.fqdn),
        hostlabel: text(record.hostlabel),
        zone: text(record.zone),
        requiredValue: text(record.requiredValue),
        currentValue: text(record.currentValue),
        status: text(record.status),
        purpose: text(record.purpose),
      })),
    },
  };
}

export class RailwayClient {
  private readonly fetcher: Fetch;
  constructor(
    private readonly options: { token: string; projectId: string; serviceId: string; environmentId: string; fetch?: Fetch; url?: string },
  ) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.options.url ?? RAILWAY_API, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new RailwayError(`Could not reach Railway (${error instanceof Error ? error.message : "network error"}).`, 0);
    }
    let payload: { data?: T; errors?: { message?: string }[] } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = {};
    }
    const message = payload.errors?.[0]?.message?.trim();
    if (!response.ok || message || !payload.data) {
      throw new RailwayError(message || `Railway returned HTTP ${response.status}.`, response.status);
    }
    return payload.data;
  }

  async isAvailable(domain: string): Promise<{ available: boolean; message: string }> {
    const data = await this.graphql<{ customDomainAvailable: { available: boolean; message: string } }>(
      "query Available($domain: String!) { customDomainAvailable(domain: $domain) { available message } }",
      { domain },
    );
    return { available: data.customDomainAvailable.available === true, message: data.customDomainAvailable.message ?? "" };
  }

  async createDomain(domain: string): Promise<RailwayDomain> {
    const data = await this.graphql<{ customDomainCreate: unknown }>(
      `mutation Create($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { ${DOMAIN_FIELDS} } }`,
      {
        input: {
          domain,
          projectId: this.options.projectId,
          serviceId: this.options.serviceId,
          environmentId: this.options.environmentId,
        },
      },
    );
    return toDomain(data.customDomainCreate);
  }

  async getDomain(id: string): Promise<RailwayDomain> {
    const data = await this.graphql<{ customDomain: unknown }>(
      `query Domain($id: String!, $projectId: String!) { customDomain(id: $id, projectId: $projectId) { ${DOMAIN_FIELDS} } }`,
      { id, projectId: this.options.projectId },
    );
    return toDomain(data.customDomain);
  }

  async deleteDomain(id: string): Promise<boolean> {
    const data = await this.graphql<{ customDomainDelete: boolean }>("mutation Delete($id: String!) { customDomainDelete(id: $id) }", { id });
    return data.customDomainDelete === true;
  }

  /** How many custom domains the service already has (counts against the plan limit). */
  async countCustomDomains(): Promise<number> {
    const data = await this.graphql<{ domains: { customDomains: unknown[] } }>(
      "query Count($projectId: String!, $serviceId: String!, $environmentId: String!) { domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) { customDomains { id } } }",
      { projectId: this.options.projectId, serviceId: this.options.serviceId, environmentId: this.options.environmentId },
    );
    return Array.isArray(data.domains?.customDomains) ? data.domains.customDomains.length : 0;
  }
}

export function railwayFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher?: Fetch): RailwayClient | null {
  const token = env.RAILWAY_API_TOKEN?.trim();
  const projectId = env.RAILWAY_PROJECT_ID?.trim();
  const serviceId = env.RAILWAY_SERVICE_ID?.trim();
  const environmentId = env.RAILWAY_ENVIRONMENT_ID?.trim();
  if (!token || !projectId || !serviceId || !environmentId) return null;
  return new RailwayClient({ token, projectId, serviceId, environmentId, fetch: fetcher });
}
