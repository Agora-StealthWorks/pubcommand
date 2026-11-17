import { CATEGORIES, type Category } from "../../../../../modules/support/taxonomy";
import { agentJson, type AgentContext } from "./agent-api";
import { getScopedRecord } from "./search";

/** get_record: one published record inside the key's scope. */
export async function recordResponse(ctx: AgentContext, id: string): Promise<Response> {
  ctx.query = id;
  const record = await getScopedRecord({ organizationId: ctx.organizationId, brandId: ctx.brandId, scope: ctx.scope }, id.trim());
  ctx.hits = record ? 1 : 0;
  // Out of scope and missing look the same: a key cannot probe for records it may not read.
  if (!record) return agentJson(404, { found: false, message: "No such record." });
  return agentJson(200, {
    found: true,
    id: record.id,
    kind: CATEGORIES[record.category as Category]?.label ?? record.category,
    audience: record.audience,
    title: record.title,
    summary: record.summary || null,
    text: record.body,
    link: record.url,
    publications: record.publicationCodes,
    updated: record.updatedAt.toISOString().slice(0, 10),
  });
}
