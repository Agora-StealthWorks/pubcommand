import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { recordCounts } from "@/features/support/data";
import { supportPage } from "@/features/support/guard";
import { SubNav } from "@/features/support/ui";
import { currentRequest } from "@/lib/request";

export default async function SupportLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await supportPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { pathname } = await currentRequest();
  const active = pathname.startsWith("/support/sources") ? "sources" : pathname.startsWith("/support/agents") ? "agents" : pathname.startsWith("/support/gaps") ? "gaps" : "records";
  const counts = await recordCounts(access.ctx.resolved.id, access.ctx.brand.id);
  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Support Knowledge</h1>
        <p className="max-w-3xl text-sm text-muted">
          What {access.ctx.brand.name}&apos;s customer support agents may say. Only published records reach an agent, and only inside its scope. Internal material is blocked by the content gate.
        </p>
      </div>
      <SubNav active={active} counts={{ gaps: counts.gaps, proposals: counts.proposals }} />
      {children}
    </div>
  );
}
