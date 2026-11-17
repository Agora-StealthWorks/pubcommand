import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { wikiPage } from "@/features/wiki/guard";
import { WikiNav } from "@/features/wiki/ui";
import { currentRequest } from "@/lib/request";

export default async function WikiLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { pathname } = await currentRequest();
  const active = pathname.startsWith("/wiki/publications") ? "publications" : pathname.startsWith("/wiki/editors") ? "editors" : "home";
  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Wiki</h1>
        <p className="text-sm text-muted">Everything about {access.ctx.brand.name}&apos;s publications and editors, read from Publication Setup.</p>
      </div>
      <WikiNav active={active} />
      {children}
    </div>
  );
}
