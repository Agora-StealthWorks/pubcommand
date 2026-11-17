import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";

/** Shared create/edit form. `action` is a server action. */
export function NoteForm({
  action,
  scopeMain,
  cancelHref,
  note,
  folder,
  targetLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  scopeMain: boolean;
  cancelHref: string;
  note?: { id: string; title: string; body: string; folder: string | null };
  folder?: string | null;
  targetLabel: string;
}) {
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-white p-5">
      {scopeMain ? <input type="hidden" name="scope" value="main" /> : null}
      {note ? <input type="hidden" name="noteId" value={note.id} /> : null}
      <p className="text-sm text-muted">
        Saves to <strong className="text-ink">{targetLabel}</strong>.
      </p>
      <div>
        <Label htmlFor="note-title">Title</Label>
        <Input id="note-title" name="title" required maxLength={200} defaultValue={note?.title ?? ""} />
        <p className="mt-1 text-xs text-muted">Other notes link here with [[{note?.title || "Title"}]].</p>
      </div>
      <div>
        <Label htmlFor="note-folder">Folder</Label>
        <Input id="note-folder" name="folder" maxLength={300} defaultValue={note?.folder ?? folder ?? ""} placeholder="e.g. Copy/Headlines (blank = top level)" />
      </div>
      <div>
        <Label htmlFor="note-body">Markdown</Label>
        <Textarea id="note-body" name="body" required rows={18} defaultValue={note?.body ?? ""} className="font-mono text-sm" />
        <p className="mt-1 text-xs text-muted">Markdown, tables and [[Wiki links]] to other notes. Never paste passwords or API keys.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit">Save note</Button>
        <Link href={cancelHref} className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-3.5 text-sm font-semibold">
          Cancel
        </Link>
      </div>
    </form>
  );
}
