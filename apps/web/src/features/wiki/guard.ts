import { getOrgContext } from "@/lib/org";
import { canTestimonials } from "../../../../../modules/testimonials/access";
import { canReadWiki, canUse } from "../../../../../modules/wiki/access";

/** Every wiki page and route calls this: entitlement + wiki.read, and a brand to read. */
export async function wikiPage(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("wiki")) return { kind: "denied" as const, title: "The Wiki is turned off for this organization" };
  if (!canReadWiki(ctx.subject, ctx.scope)) return { kind: "denied" as const, title: "You do not have access to the Wiki" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    can: {
      editSetup: canUse(ctx.subject, ctx.scope, "pubsetup", "pubsetup.manage"),
      testimonials: canTestimonials(ctx.subject, ctx.scope, "testimonials.read"),
      addTestimonial: canTestimonials(ctx.subject, ctx.scope, "testimonials.write"),
      calendar: canUse(ctx.subject, ctx.scope, "editorial", "editorial.read"),
      promos: canUse(ctx.subject, ctx.scope, "promo-studio", "promo.read"),
    },
  };
}
