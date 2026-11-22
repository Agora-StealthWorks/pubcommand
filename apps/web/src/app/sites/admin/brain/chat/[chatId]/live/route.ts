import { renderNote } from "@/features/brain/markdown";
import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";

export const dynamic = "force-dynamic";

/** The answer being written in one BrainChat, for the page to update in place. */
export async function GET(_request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const staff = await brainStaff();
  if (!staff) return Response.json({ error: "forbidden" }, { status: 403 });
  const { chatId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) return Response.json({ error: "not found" }, { status: 404 });
  const message = await mainBrain((tx) =>
    tx.mainBrainChatMessage.findFirst({
      where: { chatId, role: "assistant", chat: { createdById: staff.userId, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, content: true, error: true, activity: true },
    }),
  );
  if (!message) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(
    { id: message.id, status: message.status, html: message.content ? renderNote(message.content, () => null).html : "", error: message.error, activity: message.activity },
    { headers: { "cache-control": "no-store" } },
  );
}
