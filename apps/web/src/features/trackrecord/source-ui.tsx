import { Button, Input, Label } from "@pubcommand/ui";
import { createSource } from "./source-actions";
import type { SourceRow } from "./sources";

const when = (date: Date | null) => (date ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never");

export function SourceList({ sources }: { sources: SourceRow[] }) {
  if (!sources.length) return <p className="text-sm text-muted">No connected sources yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {sources.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <a href={`/performance/import/sources/${s.id}`} className="min-w-0 break-words font-semibold text-accent">
            {s.name}
          </a>
          <span className="text-xs text-muted">
            {s.kind === "AIRTABLE" ? "Airtable" : "Google Sheet"} · {s.autoSync ? "hourly re-sync" : "manual"} · last {when(s.lastSyncAt)}
            {s.lastStatus === "failed" ? <span className="text-[#b42318]"> · failed</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SourceForm({ portfolios }: { portfolios: string[] }) {
  return (
    <form action={createSource} className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="src-kind">Source</Label>
        <select id="src-kind" name="kind" className="pc-control w-full" defaultValue="GSHEET">
          <option value="GSHEET">Google Sheet</option>
          <option value="AIRTABLE">Airtable</option>
        </select>
      </div>
      <div>
        <Label htmlFor="src-name">Name</Label>
        <Input id="src-name" name="name" maxLength={120} placeholder="Closed trades sheet" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="src-url">Link</Label>
        <Input id="src-url" name="url" maxLength={500} required placeholder="https://docs.google.com/spreadsheets/d/… or https://airtable.com/app…/tbl…" />
      </div>
      <div>
        <Label htmlFor="src-token">Your token</Label>
        <Input id="src-token" name="token" type="password" autoComplete="off" maxLength={500} />
        <p className="mt-1 text-xs text-muted">Airtable: a personal access token with read access. Google: optional API key (leave blank for a sheet shared with anyone who has the link). Encrypted, never shown again.</p>
      </div>
      <div>
        <Label htmlFor="src-range">Google tab or range</Label>
        <Input id="src-range" name="range" maxLength={120} placeholder="Closed!A:Z" />
        <Label htmlFor="src-table" className="mt-2">Airtable table name</Label>
        <Input id="src-table" name="table" maxLength={120} placeholder="Only if the link has no tbl… id" />
      </div>
      <div>
        <Label htmlFor="src-portfolio">Portfolio for rows without one</Label>
        <select id="src-portfolio" name="defaultPortfolio" className="pc-control w-full" defaultValue={portfolios[0] ?? ""}>
          <option value="">Use the source&apos;s portfolio column</option>
          {portfolios.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm">
        <input type="checkbox" name="autoSync" defaultChecked className="h-4 w-4" />
        Re-sync every hour
      </label>
      <div className="sm:col-span-2">
        <Button type="submit">Connect and dry run</Button>
      </div>
    </form>
  );
}
