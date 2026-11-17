import { handleSubscribe } from "@/features/miniblog/public-routes";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return handleSubscribe(request, slug, siteSlug);
}
