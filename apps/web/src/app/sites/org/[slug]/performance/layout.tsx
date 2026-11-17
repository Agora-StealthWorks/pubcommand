import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { TrackTabs } from "@/features/trackrecord/tabs";
import { getOrgContext } from "@/lib/org";

export default async function TrackRecordLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Track Record</h1>
          <p className="text-sm text-muted">{access.scope.brandName} · gains from real prices, never from the AI</p>
        </div>
        <TrackTabs canWrite={access.scope.canWrite} />
      </div>
      {children}
    </div>
  );
}
