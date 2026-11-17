import { can } from "@pubcommand/core";
import { Prisma, tenantDb } from "@pubcommand/db";
import { getOrgContext } from "@/lib/org";
import { cloudflareFromEnv } from "./cloudflare";
import type { LedgerFinish, LedgerStart, PurchaseLedger } from "./purchase";
import { railwayFromEnv } from "./railway";
import type { Providers } from "./service";

/** Page/action/route guard for Settings → Domains. Checked on every entry point. */
export async function domainsAccess(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("settings") || !can(ctx.subject, "domains.manage", ctx.scope)) {
    return { kind: "denied" as const };
  }
  return { kind: "ok" as const, ctx };
}

export function providersFromEnv(): Providers {
  return { railway: railwayFromEnv(), cloudflare: cloudflareFromEnv() };
}

/** `domain_purchases` writer for purchaseDomain(). */
export function purchaseLedger(organizationId: string): PurchaseLedger {
  const db = tenantDb(organizationId);
  return {
    async start(input: LedgerStart) {
      const row = await db.domainPurchase.create({
        data: {
          organizationId,
          brandId: input.brandId,
          actorId: input.actorId,
          domain: input.domain,
          price: new Prisma.Decimal(input.price),
          currency: input.currency.toUpperCase(),
          sandbox: input.sandbox,
          result: "STARTED",
        },
        select: { id: true },
      });
      return row.id;
    },
    async finish(id: string, update: LedgerFinish) {
      await db.domainPurchase.updateMany({
        where: { id },
        data: {
          result: update.result,
          error: update.error ?? null,
          registrarStatus: update.registrarStatus ?? null,
          workflowUrl: update.workflowUrl ?? null,
          paymentReference: update.paymentReference ?? null,
          response: update.response === undefined || update.response === null ? Prisma.DbNull : (update.response as Prisma.InputJsonValue),
        },
      });
    },
  };
}
