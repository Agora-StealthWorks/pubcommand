import Link from "next/link";
import { renderNote } from "../brain/markdown";
import { AutoRefresh } from "../promos/auto-refresh";
import { mainBrain } from "../main-brain/db";
import type { StoredUpload } from "./server";

/** An answer still RUNNING this long (server restarted mid-turn) can be stopped. */
export const STALE_ANSWER_MS = 4 * 60 * 1000;

export async function listChats(userId: string) {
  return mainBrain((tx) => tx.mainBrainChat.findMany({ where: { createdById: userId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, updatedAt: true } }));
}

export function ChatList({ chats, activeId }: { chats: { id: string; title: string; updatedAt: Date }[]; activeId: string | null }) {
  return (
    <aside className="min-w-0 rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Chats · {chats.length}</h2>
        <Link href="/brain/chat" className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-xs font-semibold text-white">
          + New chat
        </Link>
      </div>
      <ul className="max-h-[30vh] overflow-y-auto lg:max-h-[calc(100vh-14rem)]">
        {chats.map((chat) => (
          <li key={chat.id}>
            <Link href={`/brain/chat/${chat.id}`} className={`block border-b border-line px-4 py-2.5 hover:bg-canvas ${chat.id === activeId ? "bg-[#eef2ff]" : ""}`}>
              <span className="block truncate text-sm font-medium">{chat.title}</span>
              <span className="block text-xs text-muted">{chat.updatedAt.toISOString().slice(0, 10)}</span>
            </Link>
          </li>
        ))}
        {chats.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No chats yet.</li> : null}
      </ul>
    </aside>
  );
}

type Activity = { tool: string; input: Record<string, unknown>; ok: boolean; result: string };

function activityLabel(entry: Activity): React.ReactNode {
  const noteLink = /\(\/brain\/([0-9a-f-]{36})\)/i.exec(entry.result)?.[1];
  if (entry.tool === "search_brain") return <>Searched “{String(entry.input.query ?? "")}”</>;
  if (entry.tool === "read_note") {
    const title = /^# (.+)$/m.exec(entry.result)?.[1];
    const id = String(entry.input.note_id ?? "");
    return entry.ok ? (
      <>
        Read <Link href={`/brain/${id}`} className="text-accent underline">{title ?? "a note"}</Link>
      </>
    ) : (
      <>Tried to read a note</>
    );
  }
  if (entry.tool === "list_brain") return <>Looked at {entry.input.folder ? `“${String(entry.input.folder)}”` : "the Brain’s folders"}</>;
  if (entry.tool === "save_note")
    return entry.ok && noteLink ? (
      <>
        {entry.result.startsWith("Updated") ? "Updated" : "Saved"} <Link href={`/brain/${noteLink}`} className="font-semibold text-accent underline">{String(entry.input.title ?? "a note")}</Link> to the Master Brain
      </>
    ) : (
      <>Could not save “{String(entry.input.title ?? "")}”</>
    );
  return entry.tool;
}

export function ChatMessage({ message, latest }: { message: { id: string; role: string; content: string; status: string; error: string | null; uploads: unknown; activity: unknown; updatedAt: Date }; latest: boolean }) {
  const uploads = Array.isArray(message.uploads) ? (message.uploads as StoredUpload[]) : [];
  const activity = Array.isArray(message.activity) ? (message.activity as Activity[]) : [];
  if (message.role === "user") {
    return (
      <li id={latest ? "latest" : undefined} className="flex justify-end">
        <div className="max-w-[min(42rem,100%)] min-w-0 rounded-xl bg-[#eef2ff] px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {uploads.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {uploads.map((upload) => (
                <li key={upload.noteId}>
                  <Link href={`/brain/${upload.noteId}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-canvas">
                    <span aria-hidden>📄</span>
                    <span className="truncate">{upload.name}</span>
                    <span className="text-muted">· saved{upload.scanned ? " (scanned)" : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </li>
    );
  }
  const html = message.content ? renderNote(message.content, () => null).html : "";
  const running = message.status === "RUNNING";
  return (
    <li id={latest ? "latest" : undefined} className="min-w-0">
      <div className="min-w-0 rounded-xl border border-line bg-white px-4 py-3">
        {activity.length ? (
          <ul className="mb-2 space-y-0.5 border-b border-line pb-2 text-xs text-muted">
            {activity.map((entry, index) => (
              <li key={index} className="break-words">
                {entry.ok ? "•" : "⚠"} {activityLabel(entry)}
              </li>
            ))}
          </ul>
        ) : null}
        {html ? <div className="brain-prose" dangerouslySetInnerHTML={{ __html: html }} /> : running ? <p className="text-sm text-muted">Thinking…</p> : null}
        {running ? (
          <p className="mt-2 text-xs text-muted">
            Answering · <AutoRefresh everyMs={1500} />
          </p>
        ) : null}
        {message.status === "FAILED" && message.error ? <p className="mt-2 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{message.error}</p> : null}
      </div>
    </li>
  );
}
