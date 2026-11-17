import { handleSmsOptin } from "@/features/funnels/public-routes";

/** SMS opt-in forms post here (phone + exact consent text). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string }> }) {
  const { slug, funnelSlug } = await params;
  return handleSmsOptin(request, slug, funnelSlug);
}
