import Link from "next/link";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { agentsPage } from "@/features/agents/page-access";
import { currentRequest } from "@/lib/request";

export default async function AgentsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await agentsPage(slug);
  if (!access) notFound();
  const { pathname } = await currentRequest();
  // The consent screen for connectors stands alone.
  if (pathname.startsWith("/agents/connect")) return <>{children}</>;
  const db = tenantDb(access.ctx.resolved.id);
  const pending = access.canApprove
    ? (await db.webPost.count({ where: { status: "pending", deletedAt: null, site: { brandId: { in: access.webPublishBrands } } } })) +
      (await db.textPost.count({ where: { status: "pending", deletedAt: null, site: { brandId: { in: access.textPublishBrands } } } }))
    : 0;
  const tabs = [
    { href: "/agents", label: "Agents" },
    ...(access.canApprove ? [{ href: "/agents/approvals", label: pending ? `Approvals (${pending})` : "Approvals" }] : []),
    { href: "/agents/settings", label: "Settings" },
    { href: "/agents/help", label: "How to connect" },
  ];
  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">AI Agents</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Claude, Grok, OpenAI and other agents working in {access.ctx.resolved.name} as members. Each belongs to a person here and uses that person&apos;s own AI account. Agents are labelled inside
          PubCommand only; readers never see that a post came from one.
        </p>
      </header>
      <nav className="-mb-px mb-6 flex flex-wrap gap-1 border-b border-line" aria-label="AI Agents">
        {tabs.map((tab) => {
          const active =
            tab.href === "/agents" ? pathname === "/agents" || (/^\/agents\/[0-9a-f-]{36}/.test(pathname)) : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
