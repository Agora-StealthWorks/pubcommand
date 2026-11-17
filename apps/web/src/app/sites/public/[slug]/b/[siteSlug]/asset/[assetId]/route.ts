import { siteAsset } from "@/features/miniblog/links";

/** An image uploaded into a post. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string; assetId: string }> }) {
  const { slug, siteSlug, assetId } = await params;
  return siteAsset(slug, siteSlug, assetId);
}
