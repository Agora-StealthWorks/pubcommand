import { widgetData } from "@/features/trackrecord/server";
import { widgetLimit } from "../../../../../../../../../../../modules/performance/widget";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** The widget as JSON for a page that renders its own table. Same public-safe payload as the iframe. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const limit = widgetLimit(new URL(request.url).searchParams.get("limit"));
  const data = await widgetData(slug, token, limit);
  if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: { ...CORS, "Cache-Control": "no-store" } });
  return Response.json(data, { headers: { ...CORS, "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
