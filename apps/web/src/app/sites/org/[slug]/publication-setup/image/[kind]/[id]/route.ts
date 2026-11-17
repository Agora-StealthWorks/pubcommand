import { pubsetupPage } from "@/features/pubsetup/guard";
import { getImage, type ImageKind } from "@/features/pubsetup/read";

const KINDS: readonly ImageKind[] = ["pub-logo", "pub-logo-dark", "pub-cover", "editor-photo", "brand-logo", "brand-logo-dark"];

/** Admin-only image route. Other apps serve images from their own routes via getImage(). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; kind: string; id: string }> }) {
  const { slug, kind, id } = await params;
  const access = await pubsetupPage(slug);
  if (access.kind !== "ok" || !(KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const image = await getImage(access.ctx.resolved.id, kind as ImageKind, id, access.ctx.brand.id);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.data), {
    headers: {
      "content-type": image.mime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      // SVG uploads must never run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
