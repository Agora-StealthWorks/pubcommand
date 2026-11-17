import { can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

type Permission = "promo.read" | "promo.write";

/** For pages: the org context with a brand, or the reason access is denied. */
export async function promoPage(slug: string, permission: Permission = "promo.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { denied: "notfound" as const };
  if (!ctx.subject.entitledModuleIds.includes("promo-studio")) return { denied: "Promo Analyzer is turned off" };
  if (!can(ctx.subject, permission, ctx.scope)) return { denied: "You do not have access" };
  if (!ctx.brand) return { denied: "Add a brand in Settings → Brands first" };
  return { ctx: { ...ctx, brand: ctx.brand }, writable: can(ctx.subject, "promo.write", ctx.scope) };
}

/** For server actions: redirects away unless the user may act on the current brand. */
export async function promoAction(permission: Permission, back = "/promo-studio") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!ctx.subject.entitledModuleIds.includes("promo-studio") || !can(ctx.subject, permission, ctx.scope)) {
    redirect(`${back}?error=You do not have permission.`);
  }
  if (!ctx.brand) redirect(`${back}?error=Add a brand in Settings first.`);
  return { ...ctx, brand: ctx.brand };
}

export type PromoActionContext = Awaited<ReturnType<typeof promoAction>>;
