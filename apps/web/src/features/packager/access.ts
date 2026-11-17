import { can } from "@pubcommand/core";
import { getOrgContext } from "@/lib/org";

/** Page and route gate: the org, the Promo Analyzer entitlement, promo.read and a brand. */
export async function packagerAccess(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("promo-studio")) return { kind: "denied" as const, title: "Promo Analyzer is turned off" };
  if (!can(ctx.subject, "promo.read", ctx.scope)) return { kind: "denied" as const, title: "You do not have access" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    writable: can(ctx.subject, "promo.write", ctx.scope),
    approver: can(ctx.subject, "promo.approve", ctx.scope),
  };
}
