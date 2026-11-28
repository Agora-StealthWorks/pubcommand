import { rawPrisma, type Prisma } from "@pubcommand/db";

/**
 * ISpy's shared data lives in platform tables (ispy_*) with no organization. Row-level
 * security only allows a transaction that turns on app.bypass_rls, so every read and
 * write goes through here. Org pages never call the tenant client for these tables;
 * they read through features/ispy/read.ts, which filters by the org's feeds.
 */
export async function ispyDb<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }): Promise<T> {
  return rawPrisma().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 30_000, maxWait: 10_000 },
  );
}

export type IspyTx = Prisma.TransactionClient;
