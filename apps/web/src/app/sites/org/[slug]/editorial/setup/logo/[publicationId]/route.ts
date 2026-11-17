import { tenantDb } from "@pubcommand/db";
import { calendarPage, UUID } from "@/features/calendar/context";
import { getImage } from "@/features/pubsetup/read";
import { logoFor } from "../../../../../../../../../../../modules/pubsetup/logos";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; publicationId: string }> }) {
  const { slug, publicationId } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(publicationId)) return new Response("Not found", { status: 404 });
  const pub = await tenantDb(ctx.resolved.id).calendarPublication.findFirst({ where: { id: publicationId, brandId: ctx.brand.id }, select: { logoMime: true, logoOnDarkMime: true } });
  // The setup list is a white page: the logo for light backgrounds, else the other one.
  const choice = pub ? logoFor({ id: publicationId, logos: { light: Boolean(pub.logoMime), dark: Boolean(pub.logoOnDarkMime) } }, "light") : null;
  const image = choice && (choice.kind === "pub-logo" || choice.kind === "pub-logo-dark") ? await getImage(ctx.resolved.id, choice.kind, publicationId, ctx.brand.id) : null;
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.data), {
    headers: {
      "content-type": image.mime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      // SVG logos must never run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
