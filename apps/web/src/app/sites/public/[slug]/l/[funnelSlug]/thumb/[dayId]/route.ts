import { funnelImage } from "@/features/funnels/public-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string; dayId: string }> }) {
  const { slug, funnelSlug, dayId } = await params;
  return funnelImage(slug, funnelSlug, dayId);
}
