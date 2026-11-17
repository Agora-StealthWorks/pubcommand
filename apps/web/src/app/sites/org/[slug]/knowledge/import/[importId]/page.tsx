import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { confirmVaultImport, discardVaultImport } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { ImportReportView } from "@/features/brain/import-report";

export default async function ImportReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; importId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, importId } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  if (!ctx.canWrite) return <Denied title="Importing needs the knowledge.write permission" />;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const job = await tenantDb(ctx.resolved.id).knowledgeImport.findFirst({
    where: { id: importId, brandId: ctx.scopeBrand.id },
    select: { id: true, filename: true, size: true, status: true, report: true, error: true, updatedAt: true, createdAt: true },
  });
  if (!job) notFound();
  return (
    <ImportReportView
      job={job}
      target={ctx.scopeLabel}
      backHref={brainHref("/knowledge/import")}
      openHref={brainHref("/knowledge")}
      confirmAction={confirmVaultImport}
      discardAction={discardVaultImport}
      error={query.error}
    />
  );
}
