import { tenantDb } from "@pubcommand/db";
import { UUID, supportPage } from "@/features/support/guard";
import { agentMaterial } from "@/features/support/platform";
import { currentRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

/** The agent guide as Markdown. Same checks as the page (a layout does not protect a route). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; agentId: string }> }) {
  const { slug, agentId } = await params;
  const access = await supportPage(slug);
  if (access.kind !== "ok" || !UUID.test(agentId)) return new Response("Not found", { status: 404 });
  const profile = await tenantDb(access.ctx.resolved.id).supportAgentProfile.findFirst({ where: { id: agentId, brandId: access.ctx.brand.id, deletedAt: null } });
  if (!profile) return new Response("Not found", { status: 404 });
  const { origin } = await currentRequest();
  const material = await agentMaterial(access.ctx.resolved.id, profile, origin);
  const name = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  return new Response(`${material.guide}\n`, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-guide.md"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
