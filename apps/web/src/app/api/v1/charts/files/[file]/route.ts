import { tenantDb } from "@pubcommand/db";
import { isFileToken } from "../../../../../../../../../modules/charts/api-keys";
import { apiOrganization } from "@/features/charts/api";
import { download, parseFormat, renderStored } from "@/features/charts/files";

export const dynamic = "force-dynamic";

/**
 * A chart file by its unguessable token: /api/v1/charts/files/<token>.<png|jpg|svg|pdf|ai>. No key or
 * session: the 144-bit token is the credential, so a bot can hand the link to a person. Only answers on
 * the chart's own organization host.
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = /^([A-Za-z0-9_-]+)\.(png|jpg|jpeg|svg|pdf|ai)$/.exec(file);
  if (!match || !isFileToken(match[1] as string)) return new Response("Not found", { status: 404 });
  const org = await apiOrganization();
  if (!org) return new Response("Not found", { status: 404 });
  const format = parseFormat(match[2] === "jpeg" ? "jpg" : (match[2] as string));
  if (!format || format === "thumb") return new Response("Not found", { status: 404 });
  const row = await tenantDb(org.id).chart.findFirst({ where: { fileToken: match[1], deletedAt: null } });
  if (!row) return new Response("Not found", { status: 404 });
  const query = new URL(request.url).searchParams;
  const scale = Number(query.get("scale") ?? (format === "png" || format === "jpg" ? 2 : 1)) || 1;
  const [out] = await renderStored(org.id, [row], format, { scale, embedFonts: query.get("fonts") === "embed" });
  if (!out) return new Response("Not found", { status: 404 });
  const inline = query.get("download") !== "1";
  const response = download(out.body, out.mime, out.filename, inline);
  response.headers.set("cache-control", "private, max-age=300");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}
