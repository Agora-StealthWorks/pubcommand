import type { Prisma, PrismaClient } from "@prisma/client";
import { rawPrisma } from "./client";

export class TenantIsolationError extends Error {
  constructor(message = "Tenant isolation check failed") {
    super(message);
    this.name = "TenantIsolationError";
  }
}

const TENANT_MODELS = new Set([
  "Organization",
  "OrganizationSlugHistory",
  "Brand",
  "Workspace",
  "Membership",
  "Role",
  "RolePermission",
  "Exclusion",
  "AuditLog",
  "OrganizationModule",
  "OrgSettings",
  "Promo",
  "PromoAnalysis",
  "PromoFile",
  "KnowledgePage",
  "AiUsageLog",
]);

const SCOPED_BY_ID = new Set(["Organization"]);

const READ_WRITE = new Set([
  "findMany",
  "findFirst",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "create",
  "updateMany",
  "deleteMany",
]);

export function assertOrgId(orgId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new TenantIsolationError("Organization id must be a UUID");
  }
}

type QueryArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
};

function scopeFilter(model: string, orgId: string): Record<string, string> {
  return SCOPED_BY_ID.has(model) ? { id: orgId } : { organizationId: orgId };
}

function scopeArgs(model: string, operation: string, args: QueryArgs, orgId: string): QueryArgs {
  const scope = scopeFilter(model, orgId);
  if (operation === "create") {
    if (model === "Organization") {
      throw new TenantIsolationError("Create organizations from the platform client");
    }
    const data = { ...((args.data as Record<string, unknown> | undefined) ?? {}) };
    if ("organizationId" in data && data.organizationId !== orgId) throw new TenantIsolationError();
    return { ...args, data: { ...data, organizationId: orgId } };
  }
  if (operation === "findUnique" || operation === "findUniqueOrThrow") return args;
  if (!READ_WRITE.has(operation)) {
    throw new TenantIsolationError(`Unsupported tenant operation ${model}.${operation}`);
  }
  return { ...args, where: { AND: [args.where ?? {}, scope] } };
}

function filterResult(model: string, operation: string, result: unknown, orgId: string): unknown {
  if (operation !== "findUnique" && operation !== "findUniqueOrThrow") return result;
  if (!result || typeof result !== "object") return result;
  const row = result as Record<string, unknown>;
  const key = SCOPED_BY_ID.has(model) ? "id" : "organizationId";
  if (row[key] !== orgId) {
    if (operation === "findUniqueOrThrow") throw new TenantIsolationError();
    return null;
  }
  return result;
}

export function createTenantClient(client: PrismaClient, orgId: string) {
  assertOrgId(orgId);
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args }) {
          if (!TENANT_MODELS.has(model)) {
            throw new TenantIsolationError(`${model} is not available on the tenant client`);
          }
          const scoped = scopeArgs(model, operation, args as QueryArgs, orgId);
          return client.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
            const delegateName = `${model.charAt(0).toLowerCase()}${model.slice(1)}`;
            const txRecord = tx as unknown as Record<string, Record<string, (value: unknown) => Promise<unknown>>>;
            const delegate = txRecord[delegateName];
            const run = delegate?.[operation];
            if (!run) throw new TenantIsolationError(`Unsupported tenant operation ${model}.${operation}`);
            const result = await run.call(delegate, scoped);
            return filterResult(model, operation, result, orgId);
          });
        },
      },
    },
  });
}

export function tenantDb(orgId: string) {
  return createTenantClient(rawPrisma(), orgId);
}

export async function withOrgContext<T>(
  client: PrismaClient,
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertOrgId(orgId);
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}
