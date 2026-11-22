"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send"}
    </button>
  );
}

/** Message box with file upload. Enter sends, Shift+Enter adds a line. */
export function ChatComposer({ action, chatId, busy, placeholder }: { action: (formData: FormData) => void; chatId: string | null; busy: boolean; placeholder: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<string[]>([]);
  return (
    <form ref={form} action={action} className="rounded-xl border border-line bg-white p-3">
      {chatId ? <input type="hidden" name="chatId" value={chatId} /> : null}
      <label htmlFor="brainchat-message" className="sr-only">
        Message
      </label>
      <textarea
        id="brainchat-message"
        name="message"
        rows={3}
        maxLength={40000}
        placeholder={placeholder}
        className="block w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy) form.current?.requestSubmit();
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-canvas">
          <span aria-hidden>📎</span>
          <span>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Attach files"}</span>
          <input
            type="file"
            name="files"
            multiple
            accept=".docx,.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm"
            className="sr-only"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []).map((file) => file.name))}
          />
        </label>
        <SendButton disabled={busy} />
      </div>
      {files.length ? <p className="pc-break mt-2 text-xs text-muted">{files.join(", ")} — each file is saved to the Master Brain as a note when you send.</p> : null}
      {busy ? <p className="mt-2 text-xs text-muted">BrainChat is answering…</p> : null}
    </form>
  );
}
