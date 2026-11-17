import { tenantDb } from "@pubcommand/db";
import { intelAccess } from "@/features/intel/context";

/** The transcript as a plain-text download. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; videoId: string }> }) {
  const { slug, videoId } = await params;
  const access = await intelAccess("read", slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(videoId)) return new Response("Not found", { status: 404 });
  const video = await tenantDb(access.scope.organizationId).intelVideo.findFirst({
    where: { id: videoId, brandId: access.scope.brand.id, deletedAt: null },
    select: { title: true, url: true, transcript: true, transcriptSource: true },
  });
  if (!video?.transcript) return new Response("Not found", { status: 404 });
  const body = `${video.title ?? "Video"}\n${video.url}\nTranscript source: ${video.transcriptSource ?? "unknown"}\n\n${video.transcript}\n`;
  const filename = `${(video.title ?? "transcript").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "transcript"}.txt`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
