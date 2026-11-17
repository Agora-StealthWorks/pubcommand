"use client";

import { Button, Input, Label } from "@pubcommand/ui";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { isNonce, parseCapturePayload, type CapturePayload } from "../../../../../modules/research/capture";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? "Saving…" : "Add and extract cards"}
    </Button>
  );
}

/**
 * Receives the page text from the bookmarklet (postMessage), then saves it to
 * a project through a normal server action, signed in as the viewer. The
 * nonce in the URL hash ties the message to this tab; the text is data only.
 */
export function CaptureForm({ projects, canCreate, action }: { projects: { id: string; name: string }[]; canCreate: boolean; action: (formData: FormData) => Promise<void> }) {
  const [payload, setPayload] = useState<CapturePayload | null>(null);
  const [waited, setWaited] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? (canCreate ? "new" : ""));

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const nonce = isNonce(raw) ? raw : "";
    function onMessage(event: MessageEvent) {
      const parsed = parseCapturePayload(event.data, nonce);
      if (!parsed.ok) return;
      setPayload(parsed.payload);
      try {
        (event.source as Window | null)?.postMessage({ __pcCaptureAck: nonce }, { targetOrigin: event.origin });
      } catch {
        // The acknowledgement only stops the bookmarklet retrying.
      }
    }
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => setWaited(true), 8000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, []);

  if (!payload) {
    return waited ? (
      <div className="rounded-xl border border-dashed border-line bg-white p-5 text-sm">
        <p className="font-semibold">No page arrived.</p>
        <p className="mt-1 text-muted">Open the article you want, then click the bookmarklet from that page. If nothing comes through, select the article text first and click it again.</p>
      </div>
    ) : (
      <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">Waiting for the page…</p>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-white p-4">
      <input type="hidden" name="text" value={payload.text} />
      <input type="hidden" name="url" value={payload.url ?? ""} />
      <div>
        <Label htmlFor="capture-title">Source name</Label>
        <Input id="capture-title" name="title" maxLength={200} defaultValue={payload.title} />
        {payload.url ? <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">{payload.url}</p> : null}
        <p className="mt-1 text-xs text-muted">{payload.text.length.toLocaleString()} characters captured</p>
      </div>
      <div>
        <Label htmlFor="capture-project">Add to project</Label>
        <select id="capture-project" name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="pc-control mt-1 w-full">
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
          {canCreate ? <option value="new">+ New project…</option> : null}
        </select>
      </div>
      {projectId === "new" ? (
        <div>
          <Label htmlFor="capture-new">New project name</Label>
          <Input id="capture-new" name="newName" maxLength={160} defaultValue={payload.title} />
        </div>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-accent">Preview the text</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 text-xs [overflow-wrap:anywhere]">{payload.text.slice(0, 3000)}{payload.text.length > 3000 ? "\n…" : ""}</pre>
      </details>
      {projectId ? <Submit /> : <p className="text-sm text-muted">You have no project you can add to. Ask an owner to share one with edit access.</p>}
    </form>
  );
}
