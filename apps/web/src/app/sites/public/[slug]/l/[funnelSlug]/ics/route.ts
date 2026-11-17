import { funnelIcs } from "@/features/funnels/public-routes";

/** GET /l/<funnel>/ics?day=<id> or ?block=<id>: an .ics invite in the organization's time zone. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; funnelSlug: string }> }) {
  const { slug, funnelSlug } = await params;
  return funnelIcs(request, slug, funnelSlug);
}
