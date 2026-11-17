import { appendOrgAudit } from "@pubcommand/db";
import { loadForm, loadResponses } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { buildExportTable, exportFilename, toCsv, toXlsx } from "../../../../../../../../../../modules/forms/export";

function day(value: string | null, end = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + (end ? 86400000 : 0));
}

/** Response export. Admin tier only: forms.export. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const access = await formsAccess(slug, "forms.export");
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = url.searchParams.get("status") ?? "complete";
  const responses = await loadResponses(ctx.resolved.id, formId, {
    status: status === "all" ? undefined : status,
    from: day(url.searchParams.get("from")),
    to: day(url.searchParams.get("to"), true),
  });
  const table = buildExportTable(loaded.fields, responses);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: `forms.responses.exported.${format}`, targetType: "form", targetId: formId });
  const name = exportFilename(loaded.form.title, format, new Date());
  const headers = {
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "private, no-store",
  };
  if (format === "xlsx") {
    return new Response(new Uint8Array(toXlsx(table)), { headers: { ...headers, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  }
  return new Response(toCsv(table), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
}
