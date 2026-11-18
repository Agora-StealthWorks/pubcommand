import { can } from "@pubcommand/core";
import { analysisDocx } from "@/features/promos/export-docx";
import { loadPromo } from "@/features/promos/data";
import { getOrgContext } from "@/lib/org";
import { analysisMarkdown, isStoredV2 } from "../../../../../../../../../../modules/promo-studio/stored";

/** Word export of the current analysis; `?format=md` gives Markdown (new-format analyses only). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; promoId: string }> }) {
  const { slug, promoId } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand || !ctx.subject.entitledModuleIds.includes("promo-studio") || !can(ctx.subject, "promo.read", ctx.scope)) {
    return new Response("Not found", { status: 404 });
  }
  const loaded = await loadPromo(ctx.resolved.id, ctx.brand.id, promoId);
  if (!loaded?.current) return new Response("Not analyzed yet", { status: 404 });
  const { promo, current } = loaded;
  const base = promo.title.replace(/[^\w\- ]+/g, "").trim() || "promo";
  const fk = promo.fkReadingEase != null && promo.fkGradeLevel != null ? { ease: promo.fkReadingEase, grade: promo.fkGradeLevel } : null;
  if (new URL(request.url).searchParams.get("format") === "md" && isStoredV2(current.result)) {
    const md = analysisMarkdown({
      title: promo.title,
      brandName: ctx.brand.name,
      stored: current.result,
      fk,
      meta: { publisher: promo.publisher, gurus: promo.gurus, product: promo.product, promoCode: promo.promoCode, analyzedAt: current.createdAt },
    });
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base} - analysis.md`)}`,
        "cache-control": "private, no-store",
      },
    });
  }
  const buffer = await analysisDocx({ title: promo.title, brand: ctx.brand.name, score: promo.effectivenessScore, result: current.result, sourceText: promo.sourceText, fk });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base} - analysis.docx`)}`,
      "cache-control": "private, no-store",
    },
  });
}
