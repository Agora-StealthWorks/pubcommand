import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { loadFunnelForBrand } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { toCsv } from "../../../../../../../../../../modules/funnels/checks";
import { paramCells, paramColumns } from "../../../../../../../../../../modules/funnels/tracking";
import { loadFunnelsSettings } from "@/features/funnels/tracking-data";

/** Waitlist email opt-ins as CSV. PII: funnels.publish only, and every download is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; funnelId: string }> }) {
  const { slug, funnelId } = await params;
  const access = await funnelsAccess(slug, "funnels.publish");
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const rows = await tenantDb(ctx.resolved.id).funnelOptin.findMany({ where: { funnelId: loaded.funnel.id }, orderBy: { createdAt: "asc" } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "funnels.optins.exported", targetType: "funnel", targetId: loaded.funnel.id, metadata: { rows: rows.length } });
  // One column per tracked URL parameter (Funnels → Settings), plus any older key a row carries.
  const columns = paramColumns((await loadFunnelsSettings(ctx.resolved.id)).trackedParams, rows.map((row) => row.params));
  const csv = toCsv(
    ["email", "opted_in_at_utc", "consent_text", "page_url", "unsubscribed_at_utc", ...columns],
    rows.map((row) => [row.email, row.createdAt, row.consentText, row.pageUrl ?? "", row.unsubscribedAt ?? "", ...paramCells(columns, row.params)]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${loaded.funnel.slug}-optins.csv"`,
      "cache-control": "no-store",
    },
  });
}
