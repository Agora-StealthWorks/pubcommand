import { Button, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { uploadMainVault } from "@/features/main-brain/actions";
import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";

const STATUS: Record<string, string> = { DRY_RUN: "Dry run, not imported", QUEUED: "Waiting", RUNNING: "Importing", DONE: "Imported", FAILED: "Failed" };

export default async function MainImportPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const recent = await mainBrain((tx) =>
    tx.mainBrainImport.findMany({ select: { id: true, filename: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 15 }),
  );
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Import a vault into the main Brain</h1>
      <p className="mt-1 text-sm text-muted">
        For general know-how: copywriting principles, industry tactics, competitors, market and editorial craft. A publisher&apos;s own notes belong in that brand&apos;s Brain (its Import page). You see a dry run first; nothing is saved until you confirm.
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
      </div>
      <form action={uploadMainVault} className="space-y-5 rounded-xl border border-line bg-white p-5">
        <div>
          <Label htmlFor="main-vault">Vault .zip</Label>
          <input
            id="main-vault"
            name="file"
            type="file"
            accept=".zip,application/zip"
            required
            className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          <p className="mt-1 text-xs text-muted">Up to 55 MB. Re-uploading the same vault updates notes instead of duplicating them. Notes that look like they hold a secret are skipped.</p>
        </div>
        <Button type="submit" className="w-full sm:w-auto">
          Upload and check
        </Button>
      </form>
      {recent.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent uploads</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {recent.map((row) => (
              <li key={row.id}>
                <Link href={`/brain/import/${row.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-canvas">
                  <span className="min-w-0 break-all text-sm font-medium">{row.filename}</span>
                  <span className="text-xs text-muted">
                    {STATUS[row.status]} · {row.createdAt.toISOString().slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
