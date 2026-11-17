"use client";

import { Button, Textarea } from "@pubcommand/ui";
import { useActionState } from "react";
import type { AssistState } from "./actions";

export function AssistPanel({ issueId, action }: { issueId: string; action: (prev: AssistState, formData: FormData) => Promise<AssistState> }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as AssistState);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="issueId" value={issueId} />
      <Textarea name="prompt" rows={3} placeholder="e.g. Suggest five subject lines for this issue" aria-label="What should the assistant help with?" />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Writing…" : "Ask the writing assistant"}
      </Button>
      {state.status === "ok" ? <div className="whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-3 text-sm">{state.text}</div> : null}
      {state.status !== "ok" && state.status !== "idle" ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">{state.reason}</p>
      ) : null}
      <p className="text-xs text-muted">A draft to copy from. It is not saved to the issue, and it never supplies send numbers.</p>
    </form>
  );
}
