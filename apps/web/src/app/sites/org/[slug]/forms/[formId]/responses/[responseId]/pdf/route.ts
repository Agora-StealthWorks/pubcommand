import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { UUID_RE, loadForm, toResponseRecord } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { pdfFilename, responsePdf } from "../../../../../../../../../../../../modules/forms/pdf";
import { DEFAULT_ACCENT, safeColor } from "../../../../../../../../../../../../modules/forms/theme";

/** One response as PDF. It is PII, so admin tier only (forms.export). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; formId: string; responseId: string }> }) {
  const { slug, formId, responseId } = await params;
  const access = await formsAccess(slug, "forms.export");
  if (access.kind !== "ok" || !UUID_RE.test(responseId)) return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const db = tenantDb(ctx.resolved.id);
  const row = await db.formResponse.findFirst({ where: { id: responseId, formId } });
  if (!row) return new Response("Not found", { status: 404 });
  const theme = loaded.form.themeId ? await db.formTheme.findFirst({ where: { id: loaded.form.themeId }, select: { accentColor: true } }) : null;
  const now = new Date();
  const bytes = responsePdf({ formTitle: loaded.form.title, brandName: ctx.brand.name, fields: loaded.fields, response: toResponseRecord(row), accentColor: safeColor(theme?.accentColor, DEFAULT_ACCENT) });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "forms.response.pdf", targetType: "form_response", targetId: responseId });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(pdfFilename(loaded.form.title, `response ${responseId.slice(0, 8)}`, now))}`,
      "cache-control": "private, no-store",
    },
  });
}
