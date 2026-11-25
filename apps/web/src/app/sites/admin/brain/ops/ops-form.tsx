import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { saveOpsNoteAction } from "@/features/usage/ops-actions";

export function OpsNoteForm({ note }: { note?: { id: string; title: string; body: string } }) {
  return (
    <form action={saveOpsNoteAction} className="space-y-3">
      {note ? <input type="hidden" name="id" value={note.id} /> : null}
      <div>
        <Label htmlFor="ops-title">Title</Label>
        <Input id="ops-title" name="title" defaultValue={note?.title ?? ""} required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="ops-body">Note (Markdown)</Label>
        <Textarea id="ops-body" name="body" defaultValue={note?.body ?? ""} required rows={20} className="font-mono text-sm" />
      </div>
      <Button type="submit">Save</Button>
    </form>
  );
}
