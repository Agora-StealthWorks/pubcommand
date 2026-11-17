import { tenantDb } from "@pubcommand/db";
import { UUID_RE } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";

/** A respondent's upload or signature. Admin tier only (forms.export), always a download. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; formId: string; fileId: string }> }) {
  const { slug, formId, fileId } = await params;
  const access = await formsAccess(slug, "forms.export");
  if (access.kind !== "ok" || !UUID_RE.test(formId) || !UUID_RE.test(fileId)) return new Response("Not found", { status: 404 });
  const db = tenantDb(access.ctx.resolved.id);
  const form = await db.form.findFirst({ where: { id: formId, brandId: access.ctx.brand.id }, select: { id: true } });
  if (!form) return new Response("Not found", { status: 404 });
  const file = await db.formFile.findFirst({ where: { id: fileId, formId, kind: { in: ["upload", "signature"] } } });
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
