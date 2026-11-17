"use client";

import { Button, Input, Label } from "@pubcommand/ui";
import { useActionState, useState } from "react";
import type { ApiKeyState } from "./actions";

type Props = {
  action: (previous: ApiKeyState, formData: FormData) => Promise<ApiKeyState>;
  scopes: Record<string, string>;
  brandName: string;
};

/** Create a key; the key itself is shown here once and never again. */
export function ApiKeyForm({ action, scopes, brandName }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state?.ok ? (
        <div className="rounded-md border border-[#abefc6] bg-[#ecfdf3] p-3 text-sm text-[#067647]" role="status">
          <p className="font-semibold">Key “{state.name}” created. Copy it now: it is not shown again.</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-ink" data-testid="new-api-key">
              {state.key}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                await navigator.clipboard?.writeText(state.key).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
      {state && !state.ok ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{state.error}</p> : null}
      <form action={formAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="min-w-0">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" name="name" maxLength={80} placeholder="GrokBot" required />
          </div>
          <div>
            <Label htmlFor="key-rate">Requests a minute</Label>
            <Input id="key-rate" name="rateLimit" type="number" min={1} max={600} defaultValue={60} />
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Scopes</legend>
          <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
            {Object.entries(scopes).map(([scope, help]) => (
              <label key={scope} className="flex min-w-0 items-start gap-2 text-sm">
                <input type="checkbox" name="scopes" value={scope} defaultChecked={scope !== "charts.bulk"} className="mt-1" />
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold">{scope}</span>
                  <span className="block text-xs text-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted">The key makes charts for {brandName}. Charts it makes are saved, audited and taught to the brand’s Brain like any other.</p>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>
    </div>
  );
}
