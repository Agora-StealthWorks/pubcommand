import { Button, Label } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { uploadVault } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";

const STATUS: Record<string, string> = { DRY_RUN: "Dry run, not imported", QUEUED: "Waiting", RUNNING: "Importing", DONE: "Imported", FAILED: "Failed" };

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  if (!ctx.canWrite) return <Denied title="Importing needs the knowledge.write permission" />;
  const visibleRecent = await tenantDb(ctx.resolved.id).knowledgeImport.findMany({
    where: { brandId: ctx.scopeBrand.id },
    select: { id: true, filename: true, brandId: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Import a Markdown vault</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a .zip of an Obsidian (or any Markdown) vault. You see a dry run first: how many notes are new, updated or unchanged, and every file that is skipped. Nothing is saved until you confirm.
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
      </div>
      <form action={uploadVault} className="space-y-5 rounded-xl border border-line bg-white p-5">
        <div>
          <Label htmlFor="vault-file">Vault .zip</Label>
          <input
            id="vault-file"
            name="file"
            type="file"
            accept=".zip,application/zip"
            required
            className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          <p className="mt-1 text-xs text-muted">Up to 55 MB. Folder paths are kept. Re-uploading the same vault updates notes instead of duplicating them.</p>
        </div>
        <p className="text-sm">
          Imports into <strong>{ctx.scopeLabel}</strong>. Imported notes are private to this brand. Switch brand in the sidebar to import into another brand.
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          <li>Only .md files are imported. Images, PDFs and other attachments are skipped and listed.</li>
          <li>Hidden folders such as .obsidian are skipped.</li>
          <li>Any note that looks like it holds a password, API key or token is skipped and listed (the value is never shown).</li>
        </ul>
        <Button type="submit" className="w-full sm:w-auto">
          Upload and check
        </Button>
      </form>
      {visibleRecent.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent uploads</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {visibleRecent.map((row) => (
              <li key={row.id}>
                <Link href={brainHref(`/knowledge/import/${row.id}`)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-canvas">
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
