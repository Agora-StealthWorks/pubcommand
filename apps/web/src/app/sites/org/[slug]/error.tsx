"use client";

import { useEffect } from "react";

/**
 * Shown when a page or an action in a workspace fails, instead of the browser's blank
 * "Application error". The reference matches the server log entry (Railway) for the failure.
 */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-white p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">That didn&apos;t work. Try again, or go back and retry the last step. If it keeps happening, send this reference to support.</p>
      {error.digest ? (
        <p className="mt-3 text-sm">
          Reference: <code className="rounded bg-canvas px-1.5 py-0.5 text-xs">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => reset()} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
          Try again
        </button>
        <a href="/" className="inline-flex min-h-11 items-center rounded-md border border-line px-3.5 text-sm font-semibold">
          Go to the dashboard
        </a>
      </div>
    </div>
  );
}
