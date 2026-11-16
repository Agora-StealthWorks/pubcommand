import { can } from "@pubcommand/core";
import { analysisDocx } from "@/features/promos/export-docx";
import { loadPromo } from "@/features/promos/data";
import { getOrgContext } from "@/lib/org";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; promoId: string }> }) {
  const { slug, promoId } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand || !can(ctx.subject, "promo.read", ctx.scope)) return new Response("Not found", { status: 404 });
  const loaded = await loadPromo(ctx.resolved.id, ctx.brand.id, promoId);
  if (!loaded?.current) return new Response("Not analyzed yet", { status: 404 });
  const buffer = await analysisDocx({ title: loaded.promo.title, brand: ctx.brand.name, score: loaded.promo.effectivenessScore, result: loaded.current.result });
  const name = `${loaded.promo.title.replace(/[^\w\- ]+/g, "").trim() || "promo"} - analysis.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
