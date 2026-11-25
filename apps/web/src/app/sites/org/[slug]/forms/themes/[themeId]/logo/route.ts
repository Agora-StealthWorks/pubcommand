import { tenantDb } from "@pubcommand/db";
import { UUID_RE } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";

/** Theme logo for the builder preview and themes page. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; themeId: string }> }) {
  const { slug, themeId } = await params;
  const access = await formsAccess(slug);
  if (access.kind !== "ok" || !UUID_RE.test(themeId)) return new Response("Not found", { status: 404 });
  const db = tenantDb(access.ctx.resolved.id);
  const theme = await db.formTheme.findFirst({ where: { id: themeId, brandId: access.ctx.brand.id }, select: { logoFileId: true } });
  if (!theme?.logoFileId) return new Response("Not found", { status: 404 });
  const file = await db.formFile.findFirst({ where: { id: theme.logoFileId, kind: "logo" } });
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: { "content-type": file.mimeType, "content-length": String(file.size), "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
  });
}
