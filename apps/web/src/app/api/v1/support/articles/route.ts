import { agentJson, clip, withAgent } from "@/features/support/agent-api";
import { findArticles } from "@/features/support/search";

export const dynamic = "force-dynamic";

/** find_articles: the website directory, inside the key's audiences. */
const handler = withAgent("find_articles", async (ctx, params) => {
  ctx.query = [params.topic, params.publication, params.from, params.to].filter(Boolean).join(" | ");
  if (!ctx.scope.categories.includes("website")) return agentJson(403, { error: "This agent cannot read the website directory." });
  if (!params.topic && !params.publication && !params.from && !params.to) return agentJson(400, { error: "Send a topic, a publication or a date range." });
  const articles = await findArticles({ organizationId: ctx.organizationId, brandId: ctx.brandId, scope: ctx.scope }, params);
  ctx.hits = articles.length;
  if (!articles.length) return agentJson(200, { found: false, articles: [], message: "No matching pages. Only mention pages you found." });
  return agentJson(200, {
    found: true,
    articles: articles.map((a) => ({ id: a.id, title: a.title, date: a.publishedAt, link: a.url, membersOnly: a.audience === "member", publications: a.publicationCodes, summary: a.summary ? clip(a.summary, 300) : null })),
  });
});

export const GET = handler;
export const POST = handler;
