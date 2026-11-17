import { rawPrisma, type Prisma } from "@pubcommand/db";

/**
 * The main Brain lives in platform tables (main_brain_*) with no organization.
 * Row-level security on them only allows a transaction that turns on
 * app.bypass_rls, so every read and write goes through here. Org code never
 * calls this: it only reaches tenantDb(), which cannot see these models.
 */
export async function mainBrain<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }): Promise<T> {
  return rawPrisma().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 20_000, maxWait: 10_000 },
  );
}
