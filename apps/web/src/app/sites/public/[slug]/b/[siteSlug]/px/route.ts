import { handlePixel } from "@/features/miniblog/public";

/** The first-party view pixel: counts a view (and the anonymous visitor) for the Mini-Blog or one of its posts. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return handlePixel(request, slug, siteSlug);
}
