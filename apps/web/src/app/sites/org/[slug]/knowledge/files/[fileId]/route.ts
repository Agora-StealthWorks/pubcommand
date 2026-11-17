import { tenantDb } from "@pubcommand/db";
import { loadBrain } from "@/features/brain/context";
import { getVisibleNote } from "@/features/brain/notes";
import { attachmentHeaders } from "../../../../../../../../../../modules/knowledge/attachments";

/**
 * Serve one note attachment. Same checks as the note page: signed in, Brain
 * entitled, knowledge.read, and the note visible in the current brand's Brain.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; fileId: string }> }) {
  const { slug, fileId } = await params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return notFound();
  const loaded = await loadBrain(slug);
  if (loaded.kind !== "ok") return notFound();
  const { ctx } = loaded;
  const file = await tenantDb(ctx.resolved.id).knowledgeAttachment.findFirst({ where: { id: fileId } });
  if (!file) return notFound();
  const note = await getVisibleNote(ctx.resolved.id, ctx.brain, file.noteId);
  if (!note) return notFound();
  return new Response(new Uint8Array(file.data), { headers: attachmentHeaders(file) });
}
