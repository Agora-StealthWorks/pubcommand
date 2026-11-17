import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { testimonialsPage } from "@/features/testimonials/guard";
import { listTestimonials } from "@/features/testimonials/server";
import { parseFilters, testimonialsCsv } from "../../../../../../../../../modules/testimonials/testimonials";

/** CSV of the filtered table. Contact emails only for approvers; every export is audited. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await testimonialsPage(slug);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const { ctx, can } = access;
  const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const { rows } = await listTestimonials(ctx.resolved.id, ctx.brand.id, filters, { all: true });
  const contacts = can.approve
    ? new Map(
        (await tenantDb(ctx.resolved.id).testimonial.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, contactEmail: true } })).map((r) => [r.id, r.contactEmail]),
      )
    : new Map<string, string | null>();
  const csv = testimonialsCsv(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      displayName: r.displayName,
      location: r.location,
      quote: r.quote,
      body: r.body,
      resultClaimed: r.resultClaimed,
      givenOn: r.givenOn,
      channel: r.channel,
      rating: r.rating,
      tags: r.tags,
      publication: r.publication?.name ?? null,
      editor: r.editor?.name ?? null,
      videoUrl: r.videoUrl,
      disclosure: r.disclosure,
      reviewReason: r.reviewReason,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      consent: r.consentGiven ? (r.consentMethod ?? "yes") : "none",
      contactEmail: contacts.get(r.id) ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    { includeContact: can.approve },
  );
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "testimonials.exported", targetType: "testimonial", metadata: { count: rows.length, contacts: can.approve } });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="testimonials-${ctx.brand.slug}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
