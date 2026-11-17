import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { latestSummary, loadForm, loadResponses } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { formStats } from "../../../../../../../../../../modules/forms/analytics";
import { pdfFilename, resultsPdf } from "../../../../../../../../../../modules/forms/pdf";
import { DEFAULT_ACCENT, safeColor } from "../../../../../../../../../../modules/forms/theme";

/** The results report as PDF: per-question charts and the AI summary. Aggregates only, so forms.read is enough. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const access = await formsAccess(slug, "forms.read");
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const [responses, summary, theme] = await Promise.all([
    loadResponses(ctx.resolved.id, formId),
    latestSummary(ctx.resolved.id, formId),
    loaded.form.themeId ? tenantDb(ctx.resolved.id).formTheme.findFirst({ where: { id: loaded.form.themeId }, select: { accentColor: true } }) : null,
  ]);
  const now = new Date();
  const bytes = resultsPdf({
    formTitle: loaded.form.title,
    brandName: ctx.brand.name,
    generatedAt: now,
    stats: formStats(loaded.fields, responses),
    summary: summary?.status === "DONE" ? summary.result : null,
    accentColor: safeColor(theme?.accentColor, DEFAULT_ACCENT),
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "forms.report.pdf", targetType: "form", targetId: formId });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(pdfFilename(loaded.form.title, "results", now))}`,
      "cache-control": "private, no-store",
    },
  });
}
