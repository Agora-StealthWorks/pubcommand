import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";
import { attachmentHeaders } from "../../../../../../../../../modules/knowledge/attachments";

/** Serve a main-Brain attachment to platform staff with platform.brain.manage only. */
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!(await brainStaff())) return notFound();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return notFound();
  const file = await mainBrain((tx) => tx.mainBrainAttachment.findFirst({ where: { id: fileId, note: { deletedAt: null } } }));
  if (!file) return notFound();
  return new Response(new Uint8Array(file.data), { headers: attachmentHeaders(file) });
}
