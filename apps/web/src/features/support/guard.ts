import { brandProfile, type BrandProfile } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canSupport, type SupportPermission } from "../../../../../modules/support/access";

/**
 * Page and action guards. Every page, server action and route handler calls one of these
 * (a layout check does not protect actions or routes): plan entitlement + the permission.
 */
export async function supportPage(slug: string, permission: SupportPermission = "support.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("support")) return { kind: "denied" as const, title: "Support Knowledge is not in this organization's plan" };
  if (!canSupport(ctx.subject, ctx.scope, permission)) return { kind: "denied" as const, title: permission === "support.read" ? "You do not have access to Support Knowledge" : "You cannot change this" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  const can = (perm: SupportPermission) => canSupport(ctx.subject, ctx.scope, perm);
  return { kind: "ok" as const, ctx: { ...ctx, brand: ctx.brand, profile: brandOf(ctx.brand), canWrite: can("support.write"), canPublish: can("support.publish") } };
}

export async function supportAction(permission: SupportPermission, back = "/support") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!canSupport(ctx.subject, ctx.scope, permission)) redirect(withMessage(back, "error", permission === "support.publish" ? "Only people with publish rights can do that." : "You cannot change Support Knowledge."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  const can = (perm: SupportPermission) => canSupport(ctx.subject, ctx.scope, perm);
  return { ...ctx, brand: ctx.brand, profile: brandOf(ctx.brand), actorId: ctx.auth.user.id, canPublish: can("support.publish") };
}

export type SupportCtx = Awaited<ReturnType<typeof supportAction>>;

export function brandOf(brand: { name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null }): BrandProfile {
  return brandProfile(brand);
}

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message.slice(0, 600));
  return `${base}?${params.toString()}`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authSecret(): string {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return value;
}
