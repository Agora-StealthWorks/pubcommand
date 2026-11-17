import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { PlanTable } from "@/features/trackrecord/plan-table";
import { listPortfolios } from "@/features/trackrecord/server";
import { deleteSource, syncSourceNow, updateSource } from "@/features/trackrecord/source-actions";
import { syncSource } from "@/features/trackrecord/sources";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ slug: string; sourceId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, sourceId } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) notFound();
  const source = await tenantDb(scope.organizationId).trackImportSource.findFirst({ where: { id: sourceId, brandId: scope.brandId, deletedAt: null } });
  if (!source) notFound();
  const [portfolios, dryRun] = await Promise.all([listPortfolios(scope), syncSource(scope, source, { apply: false })]);
  const importable = dryRun.ok ? dryRun.plan.counts.create + dryRun.plan.counts.close : 0;
  const where = source.kind === "AIRTABLE" ? `Airtable base ${source.airtableBase}, table ${source.airtableTable}${source.airtableView ? `, view ${source.airtableView}` : ""}` : `Google Sheet ${source.sheetId}${source.sheetRange ? `, ${source.sheetRange}` : source.sheetGid ? `, tab ${source.sheetGid}` : ""}`;

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/performance/import" className="text-sm text-accent">
        ← Import
      </Link>
      <div className="min-w-0">
        <h2 className="break-words text-xl font-semibold">{source.name}</h2>
        <p className="break-all text-sm text-muted">{where}</p>
        <p className="text-sm text-muted">
          {source.autoSync ? "Re-syncs every hour." : "Syncs only when you press Sync."} Last sync: {source.lastSyncAt ? source.lastSyncAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never"}
          {source.lastMessage ? ` · ${source.lastMessage}` : ""}
        </p>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <section className="space-y-3 rounded-xl border border-line bg-white p-4">
        <h3 className="text-base font-semibold">Dry run</h3>
        {dryRun.ok ? <PlanTable plan={dryRun.plan} /> : <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{dryRun.error}</p>}
        <form action={syncSourceNow}>
          <input type="hidden" name="sourceId" value={source.id} />
          <Button type="submit" disabled={!importable}>
            {importable ? `Sync ${importable} row${importable === 1 ? "" : "s"} now` : "Nothing to sync"}
          </Button>
        </form>
      </section>
      <form action={updateSource} className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
        <input type="hidden" name="sourceId" value={source.id} />
        <h3 className="text-sm font-semibold sm:col-span-2">Settings</h3>
        <div>
          <Label htmlFor="s-name">Name</Label>
          <Input id="s-name" name="name" defaultValue={source.name} maxLength={120} />
        </div>
        <div>
          <Label htmlFor="s-portfolio">Portfolio for rows without one</Label>
          <select id="s-portfolio" name="defaultPortfolio" className="pc-control w-full" defaultValue={source.defaultPortfolio}>
            <option value="">Use the source&apos;s portfolio column</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {source.kind === "GSHEET" ? (
          <div>
            <Label htmlFor="s-range">Tab or range (with an API key)</Label>
            <Input id="s-range" name="range" defaultValue={source.sheetRange ?? ""} maxLength={120} />
          </div>
        ) : null}
        <div>
          <Label htmlFor="s-token">Replace token</Label>
          <Input id="s-token" name="token" type="password" autoComplete="off" maxLength={500} placeholder={source.tokenEnc ? "A token is stored" : "No token stored"} />
          {source.kind === "GSHEET" && source.tokenEnc ? (
            <label className="mt-1 flex items-center gap-2 text-xs">
              <input type="checkbox" name="clearToken" /> Remove the stored key (read the link-shared CSV instead)
            </label>
          ) : null}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="autoSync" defaultChecked={source.autoSync} className="h-4 w-4" />
          Re-sync every hour
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </div>
      </form>
      <form action={deleteSource} className="rounded-xl border border-[#fecdca] bg-white p-4">
        <input type="hidden" name="sourceId" value={source.id} />
        <p className="mb-2 text-sm text-muted">Removing the source deletes its stored token. Recommendations it imported stay.</p>
        <Button type="submit" variant="danger">
          Remove source
        </Button>
      </form>
    </div>
  );
}
