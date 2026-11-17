import { handleUnsubscribe } from "@/features/funnels/public-routes";

type Context = { params: Promise<{ slug: string; funnelSlug: string }> };

/** The unsubscribe link in invites and reminders: GET asks, POST unsubscribes. */
export async function GET(request: Request, { params }: Context) {
  const { slug, funnelSlug } = await params;
  return handleUnsubscribe(request, slug, funnelSlug);
}

export async function POST(request: Request, { params }: Context) {
  const { slug, funnelSlug } = await params;
  return handleUnsubscribe(request, slug, funnelSlug);
}
