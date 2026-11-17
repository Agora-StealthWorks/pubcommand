import { agentJson, clip, withAgent } from "@/features/support/agent-api";
import { searchKnowledge } from "@/features/support/search";
import { effectiveScope } from "../../../../../../../../modules/support/scope";
import { CATEGORIES, type Category } from "../../../../../../../../modules/support/taxonomy";

export const dynamic = "force-dynamic";

/** search_knowledge: full-text search inside the key's scope. `category` can only narrow it. */
const handler = withAgent("search_knowledge", async (ctx, params) => {
  const q = (params.q ?? params.query ?? "").trim().slice(0, 500);
  ctx.query = q;
  if (!q) return agentJson(400, { error: "Send q: the customer's question." });
  const scope = effectiveScope(ctx.scope, { category: params.category });
  const hits = await searchKnowledge({ organizationId: ctx.organizationId, brandId: ctx.brandId, scope }, q, { k: Number(params.k) || 6 });
  ctx.hits = hits.length;
  if (!hits.length) return agentJson(200, { found: false, results: [], message: "Nothing found. Say you do not have that information and offer to connect them with the team." });
  return agentJson(200, {
    found: true,
    results: hits.map((hit) => ({
      id: hit.recordId,
      kind: CATEGORIES[hit.category as Category]?.label ?? hit.category,
      audience: hit.audience,
      title: hit.title,
      text: clip(hit.content),
      link: hit.url,
    })),
  });
});

export const GET = handler;
export const POST = handler;
