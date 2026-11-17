import { tenantDb } from "@pubcommand/db";
import { calendarPage, UUID } from "@/features/calendar/context";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; publicationId: string }> }) {
  const { slug, publicationId } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(publicationId)) return new Response("Not found", { status: 404 });
  const pub = await tenantDb(ctx.resolved.id).calendarPublication.findFirst({ where: { id: publicationId, brandId: ctx.brand.id }, select: { logoData: true, logoMime: true } });
  if (!pub?.logoData || !pub.logoMime) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(pub.logoData), {
    headers: {
      "content-type": pub.logoMime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      // SVG logos must never run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
