import { brandProfile, brandPromptContext, can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { KNOWLEDGE_READ, KNOWLEDGE_SHARE, KNOWLEDGE_WRITE } from "../../../../../modules/knowledge/access";
import { resolveScope, type BrainScope } from "../../../../../modules/knowledge/visibility";

type OrgOk = Extract<Awaited<ReturnType<typeof getOrgContext>>, { kind: "ok" }>;

export type BrainContext = OrgOk & {
  brain: BrainScope;
  canWrite: boolean;
  canShare: boolean;
  brandNames: Map<string, string>;
  /** The brand whose Brain this user works in. */
  scopeBrand: OrgOk["brands"][number];
  scopeLabel: string;
};

export type BrainLoad = { kind: "ok"; ctx: BrainContext } | { kind: "missing" } | { kind: "denied"; title?: string };

/**
 * Load the org, check entitlement + knowledge.read, and pick the brand's Brain.
 * An organization only ever sees brand Brains.
 */
export async function loadBrain(slug: string): Promise<BrainLoad> {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" };
  if (!ctx.subject.entitledModuleIds.includes("knowledge")) return { kind: "denied", title: "The Brain is turned off for this organization" };
  if (!can(ctx.subject, KNOWLEDGE_READ, ctx.scope)) return { kind: "denied" };
  const scopeBrand = ctx.brands.find((brand) => brand.id === ctx.scope.brandId) ?? null;
  const brain = resolveScope({ brandId: scopeBrand?.id ?? null });
  if (!brain || !scopeBrand) return { kind: "denied", title: "Add a brand in Settings → Brands first" };
  const canWrite = can(ctx.subject, KNOWLEDGE_WRITE, ctx.scope);
  return {
    kind: "ok",
    ctx: {
      ...ctx,
      brain,
      canWrite,
      canShare: canWrite && can(ctx.subject, KNOWLEDGE_SHARE, ctx.scope),
      brandNames: new Map(ctx.brands.map((brand) => [brand.id, brand.name])),
      scopeBrand,
      scopeLabel: `${scopeBrand.name} Brain`,
    },
  };
}

/** For server actions: same checks, plus an optional permission. Redirects on failure. */
export async function brainAction(permission: "read" | "write" | "share" = "read"): Promise<BrainContext> {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const loaded = await loadBrain(request.site.slug);
  if (loaded.kind !== "ok") redirect("/knowledge?error=You do not have access to the Brain.");
  const { ctx } = loaded;
  const allowed = permission === "read" ? true : permission === "write" ? ctx.canWrite : ctx.canShare;
  if (!allowed) redirect(brainHref("/knowledge", { error: "You do not have permission to do that." }));
  return ctx;
}

/** A Brain URL with extra query params. */
export function brainHref(path: string, extra: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Brand context for prompts. */
export function brainPromptContext(ctx: BrainContext): string {
  return brandPromptContext(brandProfile(ctx.scopeBrand));
}
