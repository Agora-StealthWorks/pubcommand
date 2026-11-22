import { can } from "@pubcommand/core";
import { getOrgContext, requestOrgSlug } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type IntelBrand = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };

export type IntelScope = {
  organizationId: string;
  orgSlug: string;
  brand: IntelBrand;
  actorId: string;
  canWrite: boolean;
};

export type IntelAccess = { ok: true; scope: IntelScope } | { ok: false; error: string };

/**
 * Every Intel page, action and route calls this. Reading needs intel.read; writing
 * (competitors, uploads, Gmail, extraction, radar, sending to Promo Analyzer) needs intel.write.
 */
export async function intelAccess(need: "read" | "write", slug?: string): Promise<IntelAccess> {
  const request = await currentRequest();
  const orgSlug = slug ?? requestOrgSlug(request);
  if (!orgSlug) return { ok: false, error: "Open Intel from your organization." };
  const ctx = await getOrgContext(orgSlug);
  if (ctx.kind !== "ok") return { ok: false, error: "You are not signed in to this organization." };
  if (!ctx.subject.entitledModuleIds.includes("intel")) return { ok: false, error: "Intel is turned off for this organization." };
  const canRead = can(ctx.subject, "intel.read", ctx.scope);
  const canWrite = can(ctx.subject, "intel.write", ctx.scope);
  if (!canRead && !canWrite) return { ok: false, error: "You do not have access to Intel." };
  if (need === "write" && !canWrite) return { ok: false, error: "You can view Intel but not change it. Ask an admin for intel.write." };
  if (!ctx.brand) return { ok: false, error: "Add a brand in Settings first." };
  return {
    ok: true,
    scope: {
      organizationId: ctx.resolved.id,
      orgSlug: ctx.resolved.slug,
      brand: ctx.brand,
      actorId: ctx.auth.user.id,
      canWrite,
    },
  };
}

/** Sending an email to Promo Analyzer creates a promo, so it also needs that app and promo.write. */
export async function canUsePromoAnalyzer(slug?: string): Promise<boolean> {
  const request = await currentRequest();
  const orgSlug = slug ?? requestOrgSlug(request);
  if (!orgSlug) return false;
  const ctx = await getOrgContext(orgSlug);
  return ctx.kind === "ok" && ctx.subject.entitledModuleIds.includes("promo-studio") && can(ctx.subject, "promo.write", ctx.scope);
}
