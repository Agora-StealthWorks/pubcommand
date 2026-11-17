import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { getPortfolio, positionViews, toStat } from "@/features/trackrecord/server";
import { PublicTrackRecordView } from "@/features/trackrecord/ui";
import { publicTrackRecord } from "../../../../../../../../../../modules/performance/stats";

export default async function PublicPreviewPage({ params }: { params: Promise<{ slug: string; portfolioId: string }> }) {
  const { slug, portfolioId } = await params;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const portfolio = await getPortfolio(access.scope, portfolioId);
  if (!portfolio) notFound();
  const views = await positionViews(access.scope.organizationId, { portfolioId: portfolio.id, brandId: access.scope.brandId }, { refresh: portfolio.publicIncludeOpen });
  const record = publicTrackRecord(views.map(toStat), { includeOpen: portfolio.publicIncludeOpen });
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/performance/${portfolio.id}?tab=public`} className="text-sm text-accent">
          ← Back to {portfolio.name}
        </Link>
        <span className="rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">Preview: what the public sees</span>
      </div>
      <PublicTrackRecordView record={record} title={portfolio.name} subtitle={`${access.scope.brandName}${portfolio.publication ? ` · ${portfolio.publication}` : ""}`} asOf={new Date()} />
    </div>
  );
}
