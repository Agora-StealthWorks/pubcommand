import { handleLinkClick } from "@/features/miniblog/links";

/** A tracked link in a post: counts the click, then redirects to the stored URL. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string; linkId: string }> }) {
  const { slug, siteSlug, linkId } = await params;
  return handleLinkClick(request, slug, siteSlug, linkId);
}
