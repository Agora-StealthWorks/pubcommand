import { getImage } from "@/features/pubsetup/read";
import { getFile } from "@/features/testimonials/server";
import { wikiPage } from "@/features/wiki/guard";

const PUB_KINDS = ["pub-logo", "pub-cover", "editor-photo", "brand-logo"] as const;

/** Wiki images: Publication Setup images and approved testimonials' photos, for wiki readers only. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; kind: string; id: string }> }) {
  const { slug, kind, id } = await params;
  const access = await wikiPage(slug);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx } = access;
  let image: { data: Uint8Array; mime: string } | null = null;
  if (kind === "testimonial-photo") {
    const file = await getFile(ctx.resolved.id, ctx.brand.id, id, { approvedOnly: true });
    image = file && file.kind === "photo" ? file : null;
  } else if ((PUB_KINDS as readonly string[]).includes(kind)) {
    image = await getImage(ctx.resolved.id, kind as (typeof PUB_KINDS)[number], id, ctx.brand.id);
  }
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
