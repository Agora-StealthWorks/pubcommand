"use client";

import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { useState } from "react";
import { useFormStatus } from "react-dom";

const KINDS = [
  ["text", "Paste text"],
  ["url", "Web link"],
  ["file", "PDF / Word"],
  ["youtube", "YouTube"],
] as const;
type Kind = (typeof KINDS)[number][0];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? "Reading the source…" : "Add and extract cards"}
    </Button>
  );
}

/** One form for all four ways in; the server action picks the reader from `kind`. */
export function IngestForm({ projectId, action, initialKind }: { projectId: string; action: (formData: FormData) => Promise<void>; initialKind?: string }) {
  const [kind, setKind] = useState<Kind>(KINDS.some(([key]) => key === initialKind) ? (initialKind as Kind) : "text");
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-white p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="kind" value={kind} />
      <div role="radiogroup" aria-label="Source type" className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1 sm:grid-cols-4">
        {KINDS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={kind === key}
            onClick={() => setKind(key)}
            className={`min-h-11 rounded-md px-2 text-sm font-semibold ${kind === key ? "bg-white text-accent shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "text" ? (
        <>
          <div>
            <Label htmlFor="ingest-pasted">Research text</Label>
            <Textarea id="ingest-pasted" name="pasted" rows={8} required placeholder="Paste an article, notes, a transcript or an email" />
          </div>
          <div>
            <Label htmlFor="ingest-pasted-url">Where it came from (optional)</Label>
            <Input id="ingest-pasted-url" name="pastedUrl" type="url" placeholder="https://" />
            <p className="mt-1 text-xs text-muted">Cards link back to this address.</p>
          </div>
        </>
      ) : null}
      {kind === "url" ? (
        <div>
          <Label htmlFor="ingest-url">Article or PDF link</Label>
          <Input id="ingest-url" name="url" type="url" required placeholder="https://" />
          <p className="mt-1 text-xs text-muted">Public pages only. If a site blocks readers or needs a login, paste the text instead.</p>
        </div>
      ) : null}
      {kind === "file" ? (
        <div>
          <Label htmlFor="ingest-file">File</Label>
          <input
            id="ingest-file"
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.txt,.md"
            className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          <p className="mt-1 text-xs text-muted">PDF, Word (.docx) or text, up to 50 MB. Scanned PDFs (up to 20 MB) are read by the AI.</p>
        </div>
      ) : null}
      {kind === "youtube" ? (
        <>
          <div>
            <Label htmlFor="ingest-youtube">YouTube link</Label>
            <Input id="ingest-youtube" name="youtube" type="url" required placeholder="https://www.youtube.com/watch?v=…" />
          </div>
          <div>
            <Label htmlFor="ingest-transcript">Transcript (optional)</Label>
            <Textarea id="ingest-transcript" name="transcript" rows={4} placeholder="Leave empty to use the video's captions. Paste one if the video has none." />
          </div>
        </>
      ) : null}
      <div>
        <Label htmlFor="ingest-title">Source name (optional)</Label>
        <Input id="ingest-title" name="title" maxLength={200} placeholder="Defaults to the page title or file name" />
      </div>
      <Submit />
    </form>
  );
}
