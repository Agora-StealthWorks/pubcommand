import { tenantDb } from "@pubcommand/db";
import { agentJson, supportOrganization } from "@/features/support/agent-api";
import { importPages } from "@/features/support/website";
import { hashKey, presentedKey } from "../../../../../../../../../modules/support/keys";

export const dynamic = "force-dynamic";

/**
 * WordPress-style ingest for the website directory. Write-only: the psi_ key can add or
 * update pages for one brand and read nothing back. Body: one page, an array, or { pages: [...] }.
 */
export async function POST(request: Request) {
  const org = await supportOrganization();
  if (!org) return agentJson(404, { error: "Not found." });
  const key = presentedKey(request.headers, "ingest");
  if (!key) return agentJson(401, { error: "Send the ingest key as: Authorization: Bearer psi_…" });
  const settings = await tenantDb(org.id).supportSettings.findFirst({ where: { ingestKeyHash: hashKey(key) }, select: { brandId: true } });
  if (!settings) return agentJson(401, { error: "That ingest key is not valid." });
  const text = await request.text();
  if (text.length > 10_000_000) return agentJson(413, { error: "Send at most 10 MB per request." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return agentJson(400, { error: "The body is not valid JSON." });
  }
  const rows = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { pages?: unknown }).pages) ? (body as { pages: unknown[] }).pages : [body];
  const pages = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").slice(0, 1000);
  if (!pages.length) return agentJson(400, { error: "No pages in the body." });
  const result = await importPages({ organizationId: org.id, brandId: settings.brandId, actorId: null }, pages);
  return agentJson(200, { received: rows.length, created: result.created, updated: result.updated, unchanged: result.unchanged, locked: result.locked, invalid: result.invalid.slice(0, 50), hidden: result.hidden });
}
