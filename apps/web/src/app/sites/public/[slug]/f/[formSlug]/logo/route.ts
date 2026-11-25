import { publicLogo } from "@/features/forms/public";
import { currentRequest } from "@/lib/request";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; formSlug: string }> }) {
  const { slug, formSlug } = await params;
  const site = (await currentRequest()).site;
  if (site.kind !== "org" || site.slug !== slug) return new Response("Not found", { status: 404 });
  const file = await publicLogo(slug, formSlug);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.size),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      // SVG logos must never run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
