import { funnelImage } from "@/features/funnels/public-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string }> }) {
  const { slug, funnelSlug } = await params;
  return funnelImage(slug, funnelSlug, null);
}
