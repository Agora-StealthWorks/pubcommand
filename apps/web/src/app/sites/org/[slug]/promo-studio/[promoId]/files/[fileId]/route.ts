import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { getOrgContext } from "@/lib/org";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; promoId: string; fileId: string }> }) {
  const { slug, promoId, fileId } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand || !can(ctx.subject, "promo.read", ctx.scope)) return new Response("Not found", { status: 404 });
  const db = tenantDb(ctx.resolved.id);
  const promo = await db.promo.findFirst({ where: { id: promoId, brandId: ctx.brand.id, deletedAt: null }, select: { id: true } });
  if (!promo) return new Response("Not found", { status: 404 });
  const file = await db.promoFile.findFirst({ where: { id: fileId, promoId } });
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store",
    },
  });
}
