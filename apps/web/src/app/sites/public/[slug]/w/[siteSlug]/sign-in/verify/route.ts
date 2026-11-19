import { handleSignInVerify } from "@/features/websites/public-routes";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return handleSignInVerify(request, slug, siteSlug);
}
