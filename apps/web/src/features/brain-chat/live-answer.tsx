"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Activity = { tool: string; input: Record<string, unknown>; ok: boolean; result: string };
type Live = { status: string; html: string; error: string | null; activity: Activity[] };

function label(entry: Activity): string {
  if (entry.tool === "search_brain") return `Searched “${String(entry.input.query ?? "")}”`;
  if (entry.tool === "read_note") return `Read ${/^# (.+)$/m.exec(entry.result)?.[1] ?? "a note"}`;
  if (entry.tool === "list_brain") return entry.input.folder ? `Looked at “${String(entry.input.folder)}”` : "Looked at the Brain’s folders";
  if (entry.tool === "save_note") return entry.ok ? `Saved “${String(entry.input.title ?? "")}” to the Master Brain` : `Could not save “${String(entry.input.title ?? "")}”`;
  return entry.tool;
}

/** The answer being written, updated in place as it streams; the page refreshes once when it is done. */
export function LiveAnswer({ chatId, initial }: { chatId: string; initial: Live }) {
  const router = useRouter();
  const [live, setLive] = useState<Live>(initial);
  const [seconds, setSeconds] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const poll = async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        try {
          const response = await fetch(`/brain/chat/${chatId}/live`, { cache: "no-store" });
          if (!response.ok) continue;
          const next = (await response.json()) as Live;
          setLive({ ...next, activity: Array.isArray(next.activity) ? next.activity : [] });
          if (next.status !== "RUNNING") {
            router.refresh();
            return;
          }
        } catch {
          // Try again on the next tick.
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearInterval(tick);
    };
  }, [chatId, router]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [live.html, live.activity.length]);
  return (
    <div className="min-w-0 rounded-xl border border-line bg-white px-4 py-3">
      {live.activity.length ? (
        <ul className="mb-2 space-y-0.5 border-b border-line pb-2 text-xs text-muted">
          {live.activity.map((entry, index) => (
            <li key={index} className="break-words">
              {entry.ok ? "•" : "⚠"} {label(entry)}
            </li>
          ))}
        </ul>
      ) : null}
      {live.html ? <div className="brain-prose" dangerouslySetInnerHTML={{ __html: live.html }} /> : <p className="text-sm text-muted">{live.activity.length ? "Reading the notes…" : "Thinking…"}</p>}
      <p className="mt-2 text-xs text-muted">
        Answering · <span className="tabular-nums">{seconds}s</span>
      </p>
      {live.status === "FAILED" && live.error ? <p className="mt-2 text-sm text-[#912018]">{live.error}</p> : null}
      <div ref={end} />
    </div>
  );
}
