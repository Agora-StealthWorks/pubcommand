import { tenantDb } from "@pubcommand/db";
import { chartsAccess } from "@/features/charts/context";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) {
  const { slug, assetId } = await params;
  const access = await chartsAccess(slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(assetId)) return new Response("Not found", { status: 404 });
  const asset = await tenantDb(access.scope.organizationId).chartAsset.findFirst({ where: { id: assetId } });
  if (!asset || !["image/png", "image/jpeg"].includes(asset.mimeType)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: { "content-type": asset.mimeType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
