import { PrismaClient } from "@prisma/client";

export class PlatformAuditImmutableError extends Error {
  constructor() {
    super("platform_audit_logs is append-only");
    this.name = "PlatformAuditImmutableError";
  }
}

const globalForPrisma = globalThis as { pubcommandPrisma?: PrismaClient };

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
  });
}

export function rawPrisma(): PrismaClient {
  if (!globalForPrisma.pubcommandPrisma) {
    globalForPrisma.pubcommandPrisma = createPrismaClient();
  }
  return globalForPrisma.pubcommandPrisma;
}

export function getPrisma() {
  return rawPrisma().$extends({
    query: {
      platformAuditLog: {
        async update() {
          throw new PlatformAuditImmutableError();
        },
        async updateMany() {
          throw new PlatformAuditImmutableError();
        },
        async delete() {
          throw new PlatformAuditImmutableError();
        },
        async deleteMany() {
          throw new PlatformAuditImmutableError();
        },
        async upsert() {
          throw new PlatformAuditImmutableError();
        },
      },
    },
  });
}

export type AppPrisma = ReturnType<typeof getPrisma>;
