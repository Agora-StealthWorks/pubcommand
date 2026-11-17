import { siteLogo } from "@/features/miniblog/public-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string }> }) {
  const { slug, siteSlug } = await params;
  return siteLogo(slug, siteSlug);
}
