import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { CallForm } from "@/features/trackrecord/call-form";
import { trackAccess } from "@/features/trackrecord/context";

export default async function NewCallPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; expert?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const db = tenantDb(access.scope.organizationId);
  const [experts, categories] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.trackCategory.findMany({ where: { brandId: access.scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  return (
    <div className="max-w-3xl space-y-3">
      <Link href="/performance/archive" className="text-sm text-accent">
        ← Call archive
      </Link>
      <h2 className="text-xl font-semibold">Add a call</h2>
      <Flash error={query.error} />
      {experts.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
          Add an expert first under <Link href="/performance/archive/manage" className="font-semibold text-accent">Experts and categories</Link>.
        </p>
      ) : (
        <CallForm call={null} experts={experts} categories={categories} defaultExpertId={query.expert} />
      )}
    </div>
  );
}
