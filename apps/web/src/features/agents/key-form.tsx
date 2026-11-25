"use client";

import { Button, Input, Label } from "@pubcommand/ui";
import { useActionState, useState } from "react";
import type { NewKeyState } from "./actions";

type Option = { id: string; label: string };

/** Add an agent with an API key, or make a new key for one. The key is shown here once. */
export function AgentKeyForm({
  action,
  mcpUrl,
  agentId,
  platforms,
  owners,
  roles,
  me,
  adminToggle,
}: {
  action: (previous: NewKeyState, formData: FormData) => Promise<NewKeyState>;
  mcpUrl: string;
  /** Set: make a new key for this agent. Unset: add a new agent. */
  agentId?: string;
  platforms?: Option[];
  /** Only for admins (agents.manage): choose the owner and the role. */
  owners?: Option[];
  roles?: Option[];
  me?: string;
  /** Platform agents: the "Can make admin changes" switch. */
  adminToggle?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state?.ok ? (
        <div className="rounded-md border border-[#abefc6] bg-[#ecfdf3] p-3 text-sm text-[#067647]" role="status">
          <p className="font-semibold">Key for “{state.name}” made. Copy it now: it is not shown again.</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-ink">{state.key}</code>
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
          <p className="mt-2 text-ink">
            Give the agent the MCP server <code className="break-all font-mono text-xs">{mcpUrl}</code> with the header <code className="font-mono text-xs">Authorization: Bearer {state.key.slice(0, 10)}…</code>
          </p>
          {!agentId ? (
            <a href={`/agents/${state.agentId}`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent">
              Open the agent
            </a>
          ) : null}
        </div>
      ) : null}
      {state && !state.ok ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{state.error}</p> : null}
      <form action={formAction} className="space-y-3">
        {agentId ? (
          <input type="hidden" name="agentId" value={agentId} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <Label htmlFor="agent-platform">AI platform</Label>
                <select id="agent-platform" name="platform" required defaultValue="grok" className="pc-control mt-1 w-full">
                  {(platforms ?? []).map((platform) => (
                    <option key={platform.id} value={platform.id}>
                      {platform.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="agent-name">Name</Label>
                <Input id="agent-name" name="name" maxLength={80} placeholder="e.g. Market Desk GrokBot" className="mt-1" />
              </div>
            </div>
            {owners?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="agent-owner">Whose agent</Label>
                  <select id="agent-owner" name="ownerUserId" defaultValue={me} className="pc-control mt-1 w-full">
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <Label htmlFor="agent-role">Access</Label>
                  <select id="agent-role" name="roleId" defaultValue="" className="pc-control mt-1 w-full">
                    <option value="">Same as its owner (full access)</option>
                    {(roles ?? []).map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            {adminToggle ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="allowAdminActions" defaultChecked className="mt-1 h-4 w-4" />
                <span>
                  <span className="font-semibold">Can make admin changes</span>
                  <span className="block text-muted">Suspend or resume organizations, change plans and app access, invite people, run jobs. Each needs a reason and is audited.</span>
                </span>
              </label>
            ) : null}
          </>
        )}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Working…" : agentId ? "Make a new key" : "Add agent and make its key"}
        </Button>
      </form>
    </div>
  );
}
