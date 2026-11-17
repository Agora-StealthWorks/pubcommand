import { agentJson, withAgent } from "@/features/support/agent-api";
import { categoryCounts } from "@/features/support/search";
import { tradesAllowed } from "../../../../../../../../modules/support/scope";
import { AUDIENCE_LABELS, CATEGORIES } from "../../../../../../../../modules/support/taxonomy";

export const dynamic = "force-dynamic";

/** list_categories: what this key may read, with published record counts. */
const handler = withAgent("list_categories", async (ctx) => {
  const counts = new Map((await categoryCounts({ organizationId: ctx.organizationId, brandId: ctx.brandId, scope: ctx.scope })).map((row) => [row.category, row.count]));
  ctx.hits = counts.size;
  return agentJson(200, {
    brand: ctx.brand.name,
    audiences: ctx.scope.audiences.map((a) => ({ id: a, label: AUDIENCE_LABELS[a] })),
    categories: ctx.scope.categories
      .filter((key) => key !== "trades" || tradesAllowed(ctx.scope, ctx.brand.niche))
      .map((key) => ({ id: key, label: CATEGORIES[key].label, records: key === "trades" ? null : (counts.get(key) ?? 0), live: key === "trades" })),
  });
});

export const GET = handler;
export const POST = handler;
