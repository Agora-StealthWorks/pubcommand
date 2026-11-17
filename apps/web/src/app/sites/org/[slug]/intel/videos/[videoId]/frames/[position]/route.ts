import { tenantDb } from "@pubcommand/db";
import { intelAccess } from "@/features/intel/context";

/** One stored keyframe (JPEG we made with ffmpeg). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; videoId: string; position: string }> }) {
  const { slug, videoId, position } = await params;
  const access = await intelAccess("read", slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(videoId) || !/^\d{1,2}$/.test(position)) return new Response("Not found", { status: 404 });
  const db = tenantDb(access.scope.organizationId);
  const video = await db.intelVideo.findFirst({ where: { id: videoId, brandId: access.scope.brand.id, deletedAt: null }, select: { id: true } });
  if (!video) return new Response("Not found", { status: 404 });
  const frame = await db.intelVideoFrame.findFirst({ where: { videoId: video.id, position: Number(position) }, select: { data: true } });
  if (!frame) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(frame.data), {
    headers: { "content-type": "image/jpeg", "content-length": String(frame.data.byteLength), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
