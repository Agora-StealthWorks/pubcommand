import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { isStale } from "@/features/promos/server";
import { getOrgContext } from "@/lib/org";

/** The analysis answer so far, for the live view to poll while a run streams. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; promoId: string }> }) {
  const { slug, promoId } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand || !ctx.subject.entitledModuleIds.includes("promo-studio") || !can(ctx.subject, "promo.read", ctx.scope)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(promoId)) return Response.json({ error: "Not found" }, { status: 404 });
  const promo = await tenantDb(ctx.resolved.id).promo.findFirst({
    where: { id: promoId, brandId: ctx.brand.id, deletedAt: null },
    select: { analysisStatus: true, analysisError: true, analysisLive: true, analysisStartedAt: true, updatedAt: true },
  });
  if (!promo) return Response.json({ error: "Not found" }, { status: 404 });
  const stale = isStale(promo.analysisStatus, promo.updatedAt);
  return Response.json(
    {
      status: stale ? "FAILED" : promo.analysisStatus,
      error: stale ? "The analysis was interrupted (the server restarted). Run it again." : promo.analysisError,
      text: promo.analysisLive ?? "",
      startedAt: promo.analysisStartedAt?.toISOString() ?? null,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
