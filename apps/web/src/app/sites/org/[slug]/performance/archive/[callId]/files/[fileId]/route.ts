import { tenantDb } from "@pubcommand/db";
import { trackAccess } from "@/features/trackrecord/context";
import { inlineMime } from "../../../../../../../../../../../../modules/performance/archive";

const UUID = /^[0-9a-f-]{36}$/i;

/** Serves one backup file. Honours HTTP Range so videos can seek (Safari will not play them otherwise). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; callId: string; fileId: string }> }) {
  const { slug, callId, fileId } = await params;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok || !UUID.test(callId) || !UUID.test(fileId)) return new Response("Not found", { status: 404 });
  const db = tenantDb(access.scope.organizationId);
  const call = await db.trackCall.findFirst({ where: { id: callId, brandId: access.scope.brandId, deletedAt: null }, select: { id: true } });
  if (!call) return new Response("Not found", { status: 404 });
  const file = await db.trackCallFile.findFirst({ where: { id: fileId, callId } });
  if (!file) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(file.data);
  const inline = inlineMime(file.mimeType);
  const headers: Record<string, string> = {
    "content-type": inline ? file.mimeType : "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "cache-control": "private, max-age=300",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(bytes, { headers: { ...headers, "content-length": String(bytes.length) } });
}
