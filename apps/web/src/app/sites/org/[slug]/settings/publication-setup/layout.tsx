import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { SubNav } from "@/features/pubsetup/ui";
import { currentRequest } from "@/lib/request";

export default async function PublicationSetupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { pathname } = await currentRequest();
  const active = pathname.startsWith("/settings/publication-setup/editors") ? "editors" : pathname.startsWith("/settings/publication-setup/brand") ? "brand" : pathname.startsWith("/settings/publication-setup/import") ? "import" : "publications";
  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Publication Setup</h1>
        <p className="text-sm text-muted">
          {access.ctx.brand.name}&apos;s publications, editors and branding. Admins only. Every app and the Brain read this.
        </p>
      </div>
      <SubNav active={active} />
      {children}
    </div>
  );
}
