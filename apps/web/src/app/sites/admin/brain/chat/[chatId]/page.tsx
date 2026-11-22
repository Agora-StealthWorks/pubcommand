import { Button, Input } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteBrainChat, renameBrainChat, sendBrainChatMessage, stopBrainChatAnswer } from "@/features/brain-chat/actions";
import { ChatComposer } from "@/features/brain-chat/composer";
import { ChatList, ChatMessage, listChats, STALE_ANSWER_MS } from "@/features/brain-chat/parts";
import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";

export const dynamic = "force-dynamic";

export default async function BrainChatPage({ params, searchParams }: { params: Promise<{ chatId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const staff = await brainStaff();
  if (!staff) return <Denied title="BrainChat needs the platform.brain.manage permission" />;
  const { chatId } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) notFound();
  const [chat, chats] = await Promise.all([
    mainBrain((tx) =>
      tx.mainBrainChat.findFirst({
        where: { id: chatId, createdById: staff.userId, deletedAt: null },
        include: { messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, status: true, error: true, uploads: true, activity: true, updatedAt: true } } },
      }),
    ),
    listChats(staff.userId),
  ]);
  if (!chat) notFound();
  const running = chat.messages.find((message) => message.status === "RUNNING");
  const stale = running && Date.now() - running.updatedAt.getTime() > STALE_ANSWER_MS;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ChatList chats={chats} activeId={chat.id} />
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <details className="min-w-0">
            <summary className="cursor-pointer list-none">
              <h1 className="pc-break text-xl font-semibold tracking-tight">{chat.title}</h1>
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={renameBrainChat} className="flex min-w-0 gap-2">
                <input type="hidden" name="chatId" value={chat.id} />
                <Input name="title" defaultValue={chat.title} maxLength={120} aria-label="Chat name" className="min-w-0" />
                <Button type="submit" variant="secondary">
                  Rename
                </Button>
              </form>
              <form action={deleteBrainChat}>
                <input type="hidden" name="chatId" value={chat.id} />
                <Button type="submit" variant="secondary">
                  Delete chat
                </Button>
              </form>
            </div>
          </details>
        </div>
        <Flash error={query.error} notice={query.notice} />
        <ol className="space-y-3">
          {chat.messages.map((message, index) => (
            <ChatMessage key={message.id} chatId={chat.id} message={message} latest={index === chat.messages.length - 1} />
          ))}
        </ol>
        {stale ? (
          <form action={stopBrainChatAnswer} className="mt-3">
            <input type="hidden" name="chatId" value={chat.id} />
            <p className="text-sm text-muted">
              This answer has not moved for a few minutes (the server may have restarted).{" "}
              <button type="submit" className="font-semibold text-accent underline">
                Stop it
              </button>{" "}
              and ask again.
            </p>
          </form>
        ) : null}
        <div className="sticky bottom-0 mt-4 bg-canvas pb-2 pt-1">
          <ChatComposer action={sendBrainChatMessage} chatId={chat.id} busy={Boolean(running) && !stale} placeholder="Reply, ask a follow-up, or tell the Brain something to remember…" />
        </div>
      </section>
    </div>
  );
}
