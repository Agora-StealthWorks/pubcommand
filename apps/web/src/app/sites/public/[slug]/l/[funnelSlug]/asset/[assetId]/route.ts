import { funnelAsset } from "@/features/funnels/public-routes";

/** GET /l/<funnel>/asset/<id>: an image the funnel owns (design images, host photos, block and page images). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string; assetId: string }> }) {
  const { slug, funnelSlug, assetId } = await params;
  return funnelAsset(slug, funnelSlug, assetId);
}
