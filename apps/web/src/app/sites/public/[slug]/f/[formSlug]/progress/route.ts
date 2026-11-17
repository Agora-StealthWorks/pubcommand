import { handleProgress } from "@/features/forms/public";
import { currentRequest } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; formSlug: string }> }) {
  const { slug, formSlug } = await params;
  const site = (await currentRequest()).site;
  if (site.kind !== "org" || site.slug !== slug) return Response.json({ ok: false }, { status: 404 });
  return handleProgress(request, slug, formSlug);
}
