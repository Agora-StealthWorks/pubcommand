"use client";

import { Button } from "@pubcommand/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { SecretState } from "./actions";

/** Re-renders the page every few seconds while a push or pull is running. */
export function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(refresh);
  }, [router, everyMs]);
  return null;
}

/** A button that mints a secret (agent key, ingest key, webhook secret) and shows it here once. */
export function SecretButton({
  action,
  label,
  confirm,
  hidden,
}: {
  action: (previous: SecretState, formData: FormData) => Promise<SecretState>;
  label: string;
  confirm?: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0 space-y-2">
      {state?.ok ? (
        <div className="rounded-md border border-[#abefc6] bg-[#ecfdf3] p-3 text-sm text-[#067647]" role="status">
          <p className="font-semibold">{state.label}: copy it now. It is not shown again.</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-ink" data-testid="new-secret">
              {state.secret}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                await navigator.clipboard?.writeText(state.secret).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
      {state && !state.ok ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{state.error}</p> : null}
      <form
        action={formAction}
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault();
        }}
      >
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
      </form>
    </div>
  );
}
