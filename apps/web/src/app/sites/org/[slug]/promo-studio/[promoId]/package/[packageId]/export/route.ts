import { packagerAccess } from "@/features/packager/access";
import { loadPackage } from "@/features/packager/data";
import { fileSafe, packageDocx, packageZip } from "@/features/packager/export-docx";
import { packageMarkdown } from "../../../../../../../../../../../../modules/promo-studio/packager";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; promoId: string; packageId: string }> }) {
  const { slug, promoId, packageId } = await params;
  const access = await packagerAccess(slug);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  const loaded = await loadPackage(ctx.resolved.id, ctx.brand.id, promoId, packageId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const input = {
    title: loaded.pkg.title,
    promoTitle: loaded.promo.title,
    brandName: ctx.brand.name,
    status: loaded.pkg.status,
    direction: loaded.pkg.direction,
    components: loaded.components,
  };
  const format = new URL(request.url).searchParams.get("format");
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileSafe(loaded.pkg.title)}.${ext}`)}`,
    "cache-control": "private, no-store",
  });
  if (format === "md") {
    return new Response(packageMarkdown(input), { headers: headers("text/markdown; charset=utf-8", "md") });
  }
  if (format === "zip") {
    return new Response(new Uint8Array(await packageZip(input)), { headers: headers("application/zip", "zip") });
  }
  const buffer = await packageDocx(input);
  return new Response(new Uint8Array(buffer), { headers: headers("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx") });
}
