import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { PositionForm } from "@/features/trackrecord/position-form";
import { getPortfolio } from "@/features/trackrecord/server";

export default async function NewPositionPage({ params, searchParams }: { params: Promise<{ slug: string; portfolioId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, portfolioId } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const portfolio = await getPortfolio(access.scope, portfolioId);
  if (!portfolio) notFound();
  return (
    <div className="max-w-3xl space-y-3">
      <Link href={`/performance/${portfolio.id}`} className="text-sm text-accent">
        ← {portfolio.name}
      </Link>
      <h2 className="text-xl font-semibold">Add a recommendation</h2>
      <Flash error={query.error} />
      <PositionForm portfolioId={portfolio.id} position={null} />
    </div>
  );
}
