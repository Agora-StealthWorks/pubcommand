import { serveLogo } from "@/features/websites/public-routes";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return serveLogo(request, slug, siteSlug);
}
