import { readAppCardImage } from "@/features/app-cards/store";

/**
 * An app card's uploaded artwork (Admin → App cards), for organization dashboards on any host.
 * Not secret: it is product artwork. The URL carries ?v=<updated time>, so it caches for a long time.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(moduleId)) return new Response("Not found", { status: 404 });
  const image = await readAppCardImage(moduleId);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.data), {
    headers: {
      "content-type": image.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
