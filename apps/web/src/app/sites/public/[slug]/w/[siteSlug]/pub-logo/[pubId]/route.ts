import { servePubLogo } from "@/features/websites/public-routes";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string; pubId: string }> }) {
  const { slug, siteSlug, pubId } = await params;
  return servePubLogo(request, slug, siteSlug, pubId);
}
