import { testimonialsPage } from "@/features/testimonials/guard";
import { getFile } from "@/features/testimonials/server";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string; fileId: string }> }) {
  const { slug, id, fileId } = await params;
  const access = await testimonialsPage(slug);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const file = await getFile(access.ctx.resolved.id, access.ctx.brand.id, fileId);
  if (!file || file.testimonialId !== id) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mime,
      "content-disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
