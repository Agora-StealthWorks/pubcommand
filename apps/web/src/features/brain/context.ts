import { brandProfile, brandPromptContext, can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canUseMainBrain, KNOWLEDGE_READ, KNOWLEDGE_SHARE, KNOWLEDGE_WRITE } from "../../../../../modules/knowledge/access";
import { resolveScope, type BrainScope } from "../../../../../modules/knowledge/visibility";

type OrgOk = Extract<Awaited<ReturnType<typeof getOrgContext>>, { kind: "ok" }>;

export type BrainContext = OrgOk & {
  brain: BrainScope;
  mainAllowed: boolean;
  canWrite: boolean;
  canShare: boolean;
  brandNames: Map<string, string>;
  /** The brand whose mini-brain this user works in (null when there are no brands). */
  scopeBrand: OrgOk["brands"][number] | null;
  scopeLabel: string;
};

export type BrainLoad = { kind: "ok"; ctx: BrainContext } | { kind: "missing" } | { kind: "denied"; title?: string };

/** Load the org, check entitlement + knowledge.read, and pick the Brain scope. */
export async function loadBrain(slug: string, requestedScope?: string | null): Promise<BrainLoad> {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" };
  if (!ctx.subject.entitledModuleIds.includes("knowledge")) return { kind: "denied", title: "The Brain is turned off for this organization" };
  if (!can(ctx.subject, KNOWLEDGE_READ, ctx.scope)) return { kind: "denied" };
  const mainAllowed = canUseMainBrain(ctx.subject);
  const scopeBrandId = ctx.scope.brandId ?? null;
  const scopeBrand = ctx.brands.find((brand) => brand.id === scopeBrandId) ?? null;
  const brain = resolveScope({ requested: requestedScope, brandId: scopeBrand?.id ?? null, mainAllowed });
  if (!brain) return { kind: "denied", title: "Add a brand in Settings → Brands first" };
  const canWrite = can(ctx.subject, KNOWLEDGE_WRITE, ctx.scope);
  return {
    kind: "ok",
    ctx: {
      ...ctx,
      brain,
      mainAllowed,
      canWrite,
      canShare: canWrite && can(ctx.subject, KNOWLEDGE_SHARE, ctx.scope),
      brandNames: new Map(ctx.brands.map((brand) => [brand.id, brand.name])),
      scopeBrand,
      scopeLabel: brain.kind === "main" ? "Main Brain" : `${scopeBrand?.name ?? "Brand"} mini-brain`,
    },
  };
}

/** For server actions: same checks, plus an optional permission. Redirects on failure. */
export async function brainAction(formData: FormData, permission: "read" | "write" | "share" = "read"): Promise<BrainContext> {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const loaded = await loadBrain(request.site.slug, String(formData.get("scope") ?? ""));
  if (loaded.kind !== "ok") redirect("/knowledge?error=You do not have access to the Brain.");
  const { ctx } = loaded;
  const allowed = permission === "read" ? true : permission === "write" ? ctx.canWrite : ctx.canShare;
  if (!allowed) redirect(brainHref("/knowledge", ctx.brain, { error: "You do not have permission to do that." }));
  return ctx;
}

/** A Brain URL that keeps the scope (?scope=main) plus any extra params. */
export function brainHref(path: string, scope: BrainScope, extra: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams();
  if (scope.kind === "main") params.set("scope", "main");
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Brand context for prompts in a brand scope; null for the main Brain. */
export function brainPromptContext(ctx: BrainContext): string | null {
  if (ctx.brain.kind !== "brand" || !ctx.scopeBrand) return null;
  return brandPromptContext(brandProfile(ctx.scopeBrand));
}
