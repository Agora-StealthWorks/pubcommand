import { getImage } from "@/features/pubsetup/read";
import { getOrgContext } from "@/lib/org";

/**
 * A brand's logo for the sidebar, for any member who can see the brand. The light-background
 * logo first (the sidebar is light), else the dark-background one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; brandId: string }> }) {
  const { slug, brandId } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brands.some((brand) => brand.id === brandId)) return new Response("Not found", { status: 404 });
  const image = (await getImage(ctx.resolved.id, "brand-logo", brandId, brandId)) ?? (await getImage(ctx.resolved.id, "brand-logo-dark", brandId, brandId));
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.data), {
    headers: {
      "content-type": image.mime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      // SVG uploads must never run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
