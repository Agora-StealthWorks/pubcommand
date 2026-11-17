import { handleViewerSync } from "@/features/funnels/public-routes";

/** POST /l/<funnel>/sync: page views, watched %, CTA clicks and URL keys. Sets the signed viewer cookie. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string }> }) {
  const { slug, funnelSlug } = await params;
  return handleViewerSync(request, slug, funnelSlug);
}
