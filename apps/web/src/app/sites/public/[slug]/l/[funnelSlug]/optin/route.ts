import { handleFunnelOptin } from "@/features/funnels/public-routes";

/** POST /l/<funnel>/optin: waitlist email capture (plain form post, works without JavaScript). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string }> }) {
  const { slug, funnelSlug } = await params;
  return handleFunnelOptin(request, slug, funnelSlug);
}
