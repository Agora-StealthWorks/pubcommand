import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { loadSiteForBrand } from "@/features/miniblog/data";
import { miniblogAccess } from "@/features/miniblog/guard";
import { toCsv } from "../../../../../../../../../../modules/miniblog/site";

/** SMS opt-ins with their consent records, as CSV. PII: miniblog.manage only, and every download is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const access = await miniblogAccess(slug, "miniblog.manage");
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const site = await loadSiteForBrand(ctx.resolved.id, ctx.brand.id, siteId);
  if (!site) return new Response("Not found", { status: 404 });
  const rows = await tenantDb(ctx.resolved.id).textOptin.findMany({ where: { siteId: site.id }, orderBy: { createdAt: "asc" } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "miniblog.optins.exported", targetType: "text_site", targetId: site.id, metadata: { rows: rows.length } });
  const csv = toCsv(
    ["phone_e164", "opted_in_at_utc", "consent_text", "page_url", "ip_hash"],
    rows.map((row) => [row.phone, row.createdAt, row.consentText, row.pageUrl ?? "", row.ipHash ?? ""]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${site.slug}-sms-optins.csv"`,
      "cache-control": "no-store",
    },
  });
}
