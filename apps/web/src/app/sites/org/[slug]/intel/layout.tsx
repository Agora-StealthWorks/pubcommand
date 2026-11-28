import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { intelAccess } from "@/features/intel/context";
import { IntelTabs } from "@/features/intel/tabs";
import { getOrgContext } from "@/lib/org";

export default async function IntelLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">iSpy</h1>
          <p className="text-sm text-muted">What competing publishers send and promote, for {access.scope.brand.name}.</p>
        </div>
        <IntelTabs />
      </div>
      {children}
    </div>
  );
}
