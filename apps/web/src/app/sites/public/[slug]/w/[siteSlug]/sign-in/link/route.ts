import { handleSetPasswordLinkRequest } from "@/features/websites/public-routes";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return handleSetPasswordLinkRequest(request, slug, siteSlug);
}
