import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { UUID, supportPage } from "@/features/support/guard";
import { exportBundle } from "@/features/support/platform";
import { currentRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

/** The hand-upload bundle (guide, documents, tool definitions) as a zip. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; agentId: string }> }) {
  const { slug, agentId } = await params;
  const access = await supportPage(slug);
  if (access.kind !== "ok" || !UUID.test(agentId)) return new Response("Not found", { status: 404 });
  const profile = await tenantDb(access.ctx.resolved.id).supportAgentProfile.findFirst({ where: { id: agentId, brandId: access.ctx.brand.id, deletedAt: null }, select: { id: true } });
  if (!profile) return new Response("Not found", { status: 404 });
  const { origin } = await currentRequest();
  const bundle = await exportBundle(access.ctx.resolved.id, profile.id, origin);
  if (!bundle) return new Response("Not found", { status: 404 });
  await appendOrgAudit(access.ctx.resolved.id, { actorId: access.ctx.auth.user.id, action: "support.agent.bundle_exported", targetType: "support_agent", targetId: profile.id });
  return new Response(Buffer.from(bundle.bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${bundle.filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
