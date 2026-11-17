import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canTestimonials, type TestimonialPermission } from "../../../../../modules/testimonials/access";
import { canReadWiki } from "../../../../../modules/wiki/access";

/**
 * Page and route guard for Testimonials: plan entitlement + the permission, on every
 * page, action and route (a layout check does not protect them).
 */
export async function testimonialsPage(slug: string, permission: TestimonialPermission = "testimonials.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("testimonials")) return { kind: "denied" as const, title: "Testimonials is turned off for this organization" };
  if (!canTestimonials(ctx.subject, ctx.scope, permission)) return { kind: "denied" as const, title: "You do not have access to Testimonials" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    can: {
      write: canTestimonials(ctx.subject, ctx.scope, "testimonials.write"),
      approve: canTestimonials(ctx.subject, ctx.scope, "testimonials.approve"),
      wiki: canReadWiki(ctx.subject, ctx.scope),
    },
  };
}

/** Server-action guard. Redirects back with a message instead of throwing. */
export async function testimonialsAction(permission: TestimonialPermission, back = "/testimonials") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!canTestimonials(ctx.subject, ctx.scope, permission)) redirect(withMessage(back, "error", "You do not have permission to do that."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id };
}

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message);
  return `${base}?${params.toString()}`;
}
