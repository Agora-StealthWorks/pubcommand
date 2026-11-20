import { serveMedia } from "@/features/websites/public-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string; assetId: string }> }) {
  const { slug, siteSlug, assetId } = await params;
  return serveMedia(slug, siteSlug, assetId);
}
