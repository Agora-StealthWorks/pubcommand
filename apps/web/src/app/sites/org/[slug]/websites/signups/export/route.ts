import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { csv } from "../../../../../../../../../../modules/websites/content";
import { sitePublications } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

/** CSV of free sign-ups (emails are PII: websites.members only, and every export is audited). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await websitesAccess(slug, "websites.members");
  if (access.kind !== "ok" || !access.site) return new Response("Not found", { status: 404 });
  const { ctx, site } = access;
  const pub = new URL(request.url).searchParams.get("pub");
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const name = new Map(pubs.all.map((item) => [item.id, item.name]));
  const filter = pub && name.has(pub) ? pub : undefined;
  const rows = await tenantDb(ctx.resolved.id).webSignup.findMany({ where: { siteId: site.id, ...(filter ? { publicationId: filter } : {}) }, orderBy: { createdAt: "asc" }, take: 200_000 });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "websites.signups.exported", targetType: "web_site", targetId: site.id, metadata: { rows: rows.length, publicationId: filter ?? null } });
  const body = csv([["email", "newsletter", "status", "signed_up_at", "source_page"], ...rows.map((row) => [row.email, name.get(row.publicationId) ?? row.publicationId, row.status, row.createdAt, row.source])]);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${site.slug}-signups.csv"`,
      "cache-control": "no-store",
    },
  });
}
