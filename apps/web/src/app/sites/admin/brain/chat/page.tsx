import { aiConfigured } from "@pubcommand/ai";
import { Denied, Flash } from "@/components/ui";
import { sendBrainChatMessage } from "@/features/brain-chat/actions";
import { ChatComposer } from "@/features/brain-chat/composer";
import { ChatList, listChats } from "@/features/brain-chat/parts";
import { brainStaff } from "@/features/main-brain/staff";

export const dynamic = "force-dynamic";

const STARTERS = [
  "What does the Brain know about our best-converting promos?",
  "Summarize the competitor videos VidRipper captured.",
  "Which editors and publications come up most, and what do we know about each?",
  "Remember: our webinar promos run Tuesday to Thursday, 8pm ET.",
];

export default async function BrainChatHome({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const staff = await brainStaff();
  if (!staff) return <Denied title="BrainChat needs the platform.brain.manage permission" />;
  const query = await searchParams;
  const chats = await listChats(staff.userId);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ChatList chats={chats} activeId={null} />
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">BrainChat</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Talk with the Master Brain. It searches and reads the notes before it answers and links what it used. Teach it by asking it to remember something, or attach files: each file is saved to the Master Brain as a note.
        </p>
        <div className="mt-4">
          <Flash error={query.error} notice={query.notice} />
          {!aiConfigured() ? (
            <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
              The AI key is not set, so BrainChat cannot answer yet. Files you attach are still saved to the Master Brain. Add <code>ANTHROPIC_API_KEY</code> in Railway.
            </p>
          ) : null}
        </div>
        <ChatComposer action={sendBrainChatMessage} chatId={null} busy={false} placeholder="Ask the Master Brain, or tell it something to remember…" />
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {STARTERS.map((starter) => (
            <li key={starter}>
              <form action={sendBrainChatMessage}>
                <input type="hidden" name="message" value={starter} />
                <button type="submit" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-left text-sm hover:bg-canvas">
                  {starter}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          <a href="/brain/ask?history=1" className="underline">Earlier one-off questions</a> (from “Ask the main Brain”) are still saved.
        </p>
      </section>
    </div>
  );
}
