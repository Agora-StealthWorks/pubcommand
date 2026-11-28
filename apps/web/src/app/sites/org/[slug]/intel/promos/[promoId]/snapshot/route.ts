import { readS3Config } from "@pubcommand/core";
import { ispyEmailDocument, ispyEmailHtml } from "@/features/ispy/email-view";
import { UUID, ispyOrgScope } from "@/features/ispy/org-data";
import { getPromo } from "@/features/ispy/read";
import { s3Get } from "@/lib/s3";
import { currentRequest } from "@/lib/request";

/**
 * The stored landing-page snapshot for the promo page's sandboxed iframe. Sanitized like
 * an email (no scripts, forms or frames), images through PubCommand's proxy, strict CSP.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; promoId: string }> }) {
  const { slug, promoId } = await params;
  if (!UUID.test(promoId)) return new Response("Not found", { status: 404 });
  const found = await ispyOrgScope(slug, new URL(request.url).searchParams.get("feed") ?? undefined);
  if (!found.ok) return new Response(found.error, { status: 403 });
  const data = await getPromo(found.value.viewer, promoId);
  const key = data?.landing?.snapshotKey;
  const config = readS3Config();
  if (!key || !config) return new Response("No snapshot", { status: 404 });
  const bytes = await s3Get(config, key).catch(() => null);
  if (!bytes) return new Response("No snapshot", { status: 404 });
  const { origin } = await currentRequest();
  const html = ispyEmailHtml(Buffer.from(bytes).toString("utf8"), origin).html;
  return new Response(ispyEmailDocument(html, origin), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; img-src data: ${origin}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      "referrer-policy": "no-referrer",
    },
  });
}
