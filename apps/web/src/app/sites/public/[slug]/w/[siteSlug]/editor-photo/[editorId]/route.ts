import { serveEditorPhoto } from "@/features/websites/public-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; siteSlug: string; editorId: string }> }) {
  const { slug, siteSlug, editorId } = await params;
  return serveEditorPhoto(slug, siteSlug, editorId);
}
