import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { loadFunnelForBrand } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { toCsv } from "../../../../../../../../../../modules/funnels/checks";

/** SMS opt-ins (phone, optional email, the exact consent text shown) as CSV. PII: funnels.publish only, every download audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; funnelId: string }> }) {
  const { slug, funnelId } = await params;
  const access = await funnelsAccess(slug, "funnels.publish");
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const db = tenantDb(ctx.resolved.id);
  const [rows, forms] = await Promise.all([
    db.funnelSmsOptin.findMany({ where: { funnelId: loaded.funnel.id }, orderBy: { createdAt: "asc" } }),
    db.funnelSmsForm.findMany({ where: { funnelId: loaded.funnel.id }, select: { id: true, name: true } }),
  ]);
  const names = new Map(forms.map((form) => [form.id, form.name]));
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "funnels.sms_optins.exported", targetType: "funnel", targetId: loaded.funnel.id, metadata: { rows: rows.length } });
  const csv = toCsv(
    ["phone_e164", "email", "form", "opted_in_at_utc", "consent_text", "page_url", "user_agent"],
    rows.map((row) => [row.phone, row.email ?? "", names.get(row.formId) ?? "", row.createdAt, row.consentText, row.pageUrl ?? "", row.userAgent ?? ""]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${loaded.funnel.slug}-sms-optins.csv"`,
      "cache-control": "no-store",
    },
  });
}
