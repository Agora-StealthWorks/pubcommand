import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { funnelsAccess } from "@/features/funnels/guard";
import { FunnelsTabs } from "@/features/funnels/tabs";

export default async function FunnelsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await funnelsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">Funnels · {access.ctx.brand.name}</p>
        <FunnelsTabs />
      </div>
      {children}
    </div>
  );
}
