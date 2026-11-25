import type { Viewport } from "next";
import { brandMetadata, brandThemeColor } from "@/components/brand";
import { buildSiteUrl } from "@pubcommand/core";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { OrgShell } from "@/components/org-shell";
import { Denied } from "@/components/ui";
import { rootDomain } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { loadSwitcher } from "@/features/navigation/load";

export const dynamic = "force-dynamic";
/** PubCommand's favicon and icons on its own pages (public customer sites set their own). */
export const metadata = brandMetadata;
export const viewport: Viewport = { themeColor: brandThemeColor };


export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind === "mismatch" || ctx.kind === "missing") notFound();
  if (ctx.kind === "redirect") {
    permanentRedirect(
      buildSiteUrl({
        rootDomain: rootDomain(),
        requestHost: ctx.request.host,
        site: { kind: "org", slug: ctx.resolved.slug },
        pathname: ctx.request.pathname,
        search: ctx.request.search,
      }),
    );
  }
  if (ctx.kind === "anonymous") {
    const next = buildSiteUrl({
      rootDomain: rootDomain(),
      requestHost: ctx.request.host,
      site: { kind: "org", slug },
      pathname: ctx.request.pathname,
      search: ctx.request.search,
    });
    redirect(
      buildSiteUrl({
        rootDomain: rootDomain(),
        requestHost: ctx.request.host,
        site: { kind: "marketing" },
        pathname: "/login",
        search: `?next=${encodeURIComponent(next)}`,
      }),
    );
  }
  if (ctx.kind === "suspended") {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold">{ctx.resolved.name} is suspended</h1>
        <p className="mt-2 text-sm text-muted">Platform staff can review the organization from the admin console.</p>
      </main>
    );
  }
  if (ctx.kind === "forbidden") return <Denied title="You are not a member of this organization" />;

  const [target, switcher, logos] = await Promise.all([
    ctx.impersonatingHere ? rawPrisma().user.findUnique({ where: { id: ctx.impersonatingHere.targetUserId } }) : null,
    loadSwitcher({ userId: ctx.auth.user.id, session: ctx.auth.session, here: { kind: "org", slug: ctx.resolved.slug, name: ctx.resolved.name } }),
    // Brands with a logo (Settings → Brands → Brand defaults), shown in the sidebar.
    tenantDb(ctx.resolved.id).pubBrandBranding.findMany({
      where: { OR: [{ logoMime: { not: null } }, { logoOnDarkMime: { not: null } }] },
      select: { brandId: true, updatedAt: true },
    }),
  ]);
  const brandLogos = Object.fromEntries(logos.map((row) => [row.brandId, `/brand-logo/${row.brandId}?v=${row.updatedAt.getTime()}`]));
  return (
    <OrgShell
      organization={ctx.resolved}
      brands={ctx.brands}
      brand={ctx.brand}
      subject={ctx.subject}
      pathname={ctx.request.pathname}
      email={target?.email ?? ctx.auth.user.email}
      impersonating={target ? { targetEmail: target.email } : null}
      switcher={switcher}
      brandLogos={brandLogos}
    >
      {children}
    </OrgShell>
  );
}
