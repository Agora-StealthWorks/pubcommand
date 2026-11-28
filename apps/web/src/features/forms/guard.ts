import { can } from "@pubcommand/core";
import { publicLinker } from "../domains/public-links";
import { getOrgContext } from "@/lib/org";

export type FormsPermission = "forms.read" | "forms.write" | "forms.export";

/** Page/route guard: org, entitlement, permission and brand, checked on every page and route. */
export async function formsAccess(slug: string, permission: FormsPermission = "forms.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("forms")) return { kind: "denied" as const, title: "Forms is turned off for this organization" };
  if (!can(ctx.subject, "forms.read", ctx.scope) || !can(ctx.subject, permission, ctx.scope)) return { kind: "denied" as const, title: "You do not have access" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    canWrite: can(ctx.subject, "forms.write", ctx.scope),
    canExport: can(ctx.subject, "forms.export", ctx.scope),
  };
}

/**
 * A form's public link (`/f/<form>`, its embed, or a page under it like `/results`):
 * on the form's custom domain when one is Active (Settings → Domains), on the
 * organization's PubCommand address only when there is none.
 */
export async function publicFormUrl(organizationId: string, requestHost: string, orgSlug: string, formSlug: string, kind: "f" | "embed" = "f", rest = ""): Promise<string> {
  return (await publicLinker({ organizationId, orgSlug, requestHost })).url(`/${kind}/${formSlug}${rest}`);
}
