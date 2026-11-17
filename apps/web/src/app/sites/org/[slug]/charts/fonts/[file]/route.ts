import { chartsAccess } from "@/features/charts/context";
import { fontFile } from "@/features/charts/export";

/** The bundled Inter files, so the browser preview uses the exact fonts the exporter does. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; file: string }> }) {
  const { slug, file } = await params;
  const access = await chartsAccess(slug);
  if (!access.ok) return new Response("Not found", { status: 404 });
  const data = fontFile(file);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "content-type": "font/otf", "cache-control": "private, max-age=604800, immutable" } });
}
