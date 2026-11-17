import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { ImportReportView } from "@/features/brain/import-report";
import { confirmMainVaultImport, discardMainVaultImport } from "@/features/main-brain/actions";
import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";

export default async function MainImportReportPage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { importId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const job = await mainBrain((tx) =>
    tx.mainBrainImport.findUnique({ where: { id: importId }, select: { id: true, filename: true, size: true, status: true, report: true, error: true, updatedAt: true, createdAt: true } }),
  );
  if (!job) notFound();
  return (
    <ImportReportView
      job={job}
      target="the main Brain"
      backHref="/brain/import"
      openHref="/brain"
      confirmAction={confirmMainVaultImport}
      discardAction={discardMainVaultImport}
      error={query.error}
    />
  );
}
