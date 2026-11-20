import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canManagePublications } from "../../../../../modules/pubsetup/access";

/**
 * Page and route guard. Publication Setup is admin-only: entitlement + pubsetup.manage.
 * Called by every page and route handler (a layout check does not protect them).
 */
export async function pubsetupPage(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("pubsetup")) return { kind: "denied" as const, title: "Publication Setup is turned off for this organization" };
  if (!canManagePublications(ctx.subject, ctx.scope)) return { kind: "denied" as const, title: "Publication Setup is for admins" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return { kind: "ok" as const, ctx: { ...ctx, brand: ctx.brand } };
}

/** Server-action guard. Redirects with a message instead of throwing. */
export async function pubsetupAction(back = "/settings/publication-setup") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!canManagePublications(ctx.subject, ctx.scope)) redirect(withMessage(back, "error", "Only admins can change Publication Setup."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id };
}

export type PubsetupCtx = Awaited<ReturnType<typeof pubsetupAction>>;

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message);
  return `${base}?${params.toString()}`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
