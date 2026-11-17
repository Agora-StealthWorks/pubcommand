import { exportFilename, outlineMarkdown } from "../../../../../../../../../../modules/research/export";
import { projectFor, researchContext } from "@/features/research/context";
import { exportModel, loadProjectContents } from "@/features/research/data";
import { outlineDocx } from "@/features/research/export-docx";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; projectId: string }> }) {
  const { slug, projectId } = await params;
  const context = await researchContext(slug);
  if (!context.ok) return new Response("Not found", { status: 404 });
  const found = await projectFor(context.viewer, projectId);
  if (!found) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "md" ? "md" : "docx";
  const { cards, outline } = await loadProjectContents(context.viewer.organizationId, found.project.id);
  const model = exportModel({
    name: found.project.name,
    description: found.project.description,
    brandName: context.viewer.brand.name,
    cards,
    outline,
    // With no outline yet, export the cards so the download is never empty.
    includeUnplaced: url.searchParams.get("unplaced") === "1" || outline.length === 0,
  });
  const name = exportFilename(found.project.name, format);
  const headers = { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, no-store" };
  if (format === "md") return new Response(outlineMarkdown(model), { headers: { ...headers, "content-type": "text/markdown; charset=utf-8" } });
  const buffer = await outlineDocx(model);
  return new Response(new Uint8Array(buffer), { headers: { ...headers, "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
}
