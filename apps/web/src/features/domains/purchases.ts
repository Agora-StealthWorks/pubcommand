import { Prisma, appendOrgAudit, tenantDb } from "@pubcommand/db";
import type { CloudflareClient } from "./cloudflare";

/** Follows registrations Cloudflare accepted with 202 until they finish. Runs after() a page view. */
export async function settlePendingPurchases(cloudflare: CloudflareClient | null, organizationId: string): Promise<void> {
  if (!cloudflare) return;
  const db = tenantDb(organizationId);
  const pending = await db.domainPurchase.findMany({ where: { result: "PENDING" }, take: 10 });
  for (const purchase of pending) {
    if (!purchase.workflowUrl) continue;
    try {
      const state = await cloudflare.registrationWorkflow(purchase.workflowUrl);
      if (!state.done) continue;
      const result = state.failed ? "FAILED" : "SUCCEEDED";
      await db.domainPurchase.updateMany({
        where: { id: purchase.id, result: "PENDING" },
        data: {
          result,
          registrarStatus: state.status,
          error: state.failed ? `Registration failed (${state.status ?? "unknown"}).` : null,
          response: (state.raw ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      });
      await appendOrgAudit(organizationId, {
        actorId: purchase.actorId,
        action: state.failed ? "domains.purchase.failed" : "domains.purchase.succeeded",
        targetType: "custom_domain",
        targetId: purchase.id,
        metadata: { domain: purchase.domain, registrarStatus: state.status, viaWorkflow: true },
      });
    } catch {
      // Try again on the next page view.
    }
  }
}
