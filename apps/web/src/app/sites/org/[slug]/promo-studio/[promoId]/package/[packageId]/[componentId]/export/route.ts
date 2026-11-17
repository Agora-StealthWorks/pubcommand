import { packagerAccess } from "@/features/packager/access";
import { loadPackage } from "@/features/packager/data";
import { componentDocx, fileSafe } from "@/features/packager/export-docx";

/** One component as its own Word file. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; promoId: string; packageId: string; componentId: string }> }) {
  const { slug, promoId, packageId, componentId } = await params;
  const access = await packagerAccess(slug);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadPackage(ctx.resolved.id, ctx.brand.id, promoId, packageId);
  const component = loaded?.components.find((c) => c.id === componentId);
  if (!loaded || !component) return new Response("Not found", { status: 404 });
  const buffer = await componentDocx({ promoTitle: loaded.promo.title, brandName: ctx.brand.name, packageTitle: loaded.pkg.title, component });
  const name = `${fileSafe(loaded.promo.title)} - ${fileSafe(component.label)}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
