import { buildSiteUrl, can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { BRAND_ACCENT, EXAMPLE_CSV, chartShareSearch, createChartShareToken, readChartShare, type ChartDraft } from "@pubcommand/modules/charts";
import { ChartsStudio } from "@pubcommand/modules/charts/studio";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function ChartsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getBySlug("charts");
  if (!manifest) notFound();
  if (!ctx.subject.entitledModuleIds.includes(manifest.planEntitlement)) {
    return (
      <div>
        <PageHeader title={manifest.name} description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  const canEdit = can(ctx.subject, "charts.write", ctx.scope) || can(ctx.subject, "charts.read", ctx.scope);
  if (!canEdit) return <Denied />;

  const query = await searchParams;
  const token = Array.isArray(query.share) ? (query.share[0] ?? "") : (query.share ?? "");
  const shared = token ? readChartShare(token, process.env.AUTH_SECRET ?? "", ctx.resolved.id) : null;

  async function publishShare(draft: ChartDraft) {
    "use server";
    const current = await getOrgContext(slug);
    if (current.kind !== "ok") return { error: "You are not signed in to this organization." };
    const allowed =
      can(current.subject, "charts.write", current.scope) || can(current.subject, "charts.read", current.scope);
    if (!allowed) return { error: "You cannot share charts for this organization." };
    const signed = createChartShareToken(draft, current.resolved.id, process.env.AUTH_SECRET ?? "");
    if (!signed.ok) return { error: signed.error };
    return {
      url: buildSiteUrl({
        rootDomain: process.env.ROOT_DOMAIN ?? "localhost",
        requestHost: current.request.host,
        site: { kind: "org", slug: current.resolved.slug },
        pathname: "/charts",
        search: chartShareSearch(signed.token),
      }),
    };
  }

  return (
    <ChartsStudio
      initialCsv={shared?.csv ?? EXAMPLE_CSV}
      initialAnnotation={shared ? shared.annotation : "Readers are up this spring"}
      initialAccent={shared?.accent ?? BRAND_ACCENT}
      canEdit={canEdit}
      shareNotice={token && !shared ? "This share link is not valid for this organization." : null}
      publishShare={publishShare}
    />
  );
}
