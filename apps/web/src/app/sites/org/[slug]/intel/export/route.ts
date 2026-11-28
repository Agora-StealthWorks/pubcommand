import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { intelAccess } from "@/features/intel/context";
import { inboxWhere, readFilters } from "@/features/intel/data";
import { readVideoFilters, videoWhere } from "@/features/intel/video-data";
import { siteUrl } from "@/lib/request";
import { emailExportCsv, exportFilename, videoExportCsv, type EmailExtraction } from "../../../../../../../../../modules/intel/index";

const MAX_ROWS = 10_000;

/**
 * CSV of competitor emails (?kind=emails, the default) or captured videos
 * (?kind=videos) with their extractions, using the same filters as the pages:
 * competitor, type, from/to dates, search, and expert/list/topic.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await intelAccess("read", slug);
  if (!access.ok) return new Response(access.error, { status: 403 });
  const { scope } = access;
  const search = Object.fromEntries(new URL(request.url).searchParams.entries());
  const kind = search.kind === "videos" ? "videos" : "emails";
  const base = (await siteUrl({ kind: "org", slug: scope.orgSlug }, "/")).replace(/\/$/, "");
  const db = tenantDb(scope.organizationId);
  let csv: string;
  let rowsOut = 0;
  if (kind === "emails") {
    const filters = readFilters(search);
    const rows = await db.intelEmail.findMany({
      where: inboxWhere(scope.brand.id, filters),
      orderBy: { receivedAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        receivedAt: true,
        fromName: true,
        fromAddress: true,
        subject: true,
        source: true,
        placement: true,
        landingUrl: true,
        extraction: true,
        competitor: { select: { name: true } },
        landingPage: { select: { title: true, status: true } },
        entityRefs: { where: { entity: { kind: "list", deletedAt: null } }, take: 1, select: { entity: { select: { name: true } } } },
      },
    });
    rowsOut = rows.length;
    csv = emailExportCsv(
      rows.map((row) => ({
        id: row.id,
        receivedAt: row.receivedAt,
        competitor: row.competitor?.name ?? null,
        list: row.entityRefs[0]?.entity.name ?? null,
        fromName: row.fromName,
        fromAddress: row.fromAddress,
        subject: row.subject,
        source: row.source,
        placement: row.placement,
        landingUrl: row.landingUrl,
        landingTitle: row.landingPage?.status === "OK" ? row.landingPage.title : null,
        extraction: (row.extraction as EmailExtraction | null) ?? null,
        link: `${base}/ispy/emails/${row.id}`,
      })),
    );
  } else {
    const filters = { ...readVideoFilters(search), expert: search.expert, topic: search.topic };
    const rows = await db.intelVideo.findMany({
      where: videoWhere(scope.brand.id, filters),
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, createdAt: true, title: true, url: true, platform: true, durationSec: true, status: true, transcriptSource: true, transcript: true, extraction: true, competitor: { select: { name: true } } },
    });
    rowsOut = rows.length;
    csv = videoExportCsv(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        competitor: row.competitor?.name ?? null,
        title: row.title,
        url: row.url,
        platform: row.platform,
        durationSec: row.durationSec,
        status: row.status,
        transcriptSource: row.transcriptSource,
        transcriptChars: row.transcript.length,
        extraction: (row.extraction as EmailExtraction | null) ?? null,
        link: `${base}/ispy/videos/${row.id}`,
      })),
    );
  }
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.exported", targetType: `intel_${kind}`, targetId: String(rowsOut) });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(kind, scope.brand.name)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
