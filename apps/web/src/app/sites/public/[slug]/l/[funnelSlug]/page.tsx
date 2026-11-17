import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orgPublicUrl } from "@/features/funnels/guard";
import { funnelBranding, funnelRules, dayRules } from "@/features/funnels/data";
import { loadPublicFunnel, publicBase, publicDays, publicSiteMatches, readViewer, statesFor, viewerFacts, type PreviewOptions } from "@/features/funnels/public";
import { ClosedView, EmailOptin, FormOptin, PreviewBar, PublicShell, WaitlistView } from "@/features/funnels/public-view";
import { ViewerSync } from "@/features/funnels/public-client";
import { currentRequest } from "@/lib/request";
import { entryDecision } from "../../../../../../../../../modules/funnels/state";

type Params = Promise<{ slug: string; funnelSlug: string }>;
type Search = Promise<PreviewOptions & { joined?: string; error?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicFunnel(slug, funnelSlug, await searchParams) : null;
  if (!loaded) return { title: { absolute: "Not found" } };
  return { title: { absolute: loaded.funnel.name }, robots: loaded.preview || loaded.funnel.status !== "published" ? { index: false, follow: false } : undefined };
}

/** The funnel's front door: waitlist countdown, the right day, or the close page. */
export default async function FunnelEntryPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, funnelSlug } = await params;
  const query = await searchParams;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicFunnel(slug, funnelSlug, query);
  if (!loaded) notFound();
  const { funnel, days, timeZone, preview, now, carry } = loaded;
  const base = await publicBase("l", funnelSlug);
  const viewer = await readViewer(funnel.id, preview && query.fresh === "1");
  const decision = entryDecision(funnelRules(funnel), days.map(dayRules), viewerFacts(viewer), now);
  if (decision.kind === "day") redirect(`${base}/day-${decision.position}${carry}`);
  if (decision.kind === "closed" && funnel.closeMode === "redirect" && funnel.closeRedirectUrl && !preview) redirect(funnel.closeRedirectUrl);
  const branding = await funnelBranding(loaded.organizationId, funnel, base);
  const request = await currentRequest();
  const previewBar = preview ? <PreviewBar asOf={now} label={funnel.status === "published" ? "" : "draft"} timeZone={timeZone} /> : null;
  const syncUrl = preview ? null : `${base}/sync`;
  let optin = null;
  if (decision.kind === "waitlist" && funnel.optinMode === "email") {
    optin = <EmailOptin funnel={funnel} branding={branding} action={`${base}/optin`} back={base || "/"} joined={query.joined === "1"} error={query.error} />;
  } else if (decision.kind === "waitlist" && funnel.optinMode === "form" && funnel.optinFormSlug) {
    optin = <FormOptin src={orgPublicUrl(request.host, slug, `/embed/${funnel.optinFormSlug}`)} headline={funnel.optinHeadline} />;
  }
  return (
    <PublicShell branding={branding} homeHref={`${base || "/"}${carry}`} preview={previewBar}>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} /> : null}
      {decision.kind === "closed" ? <ClosedView funnel={funnel} branding={branding} /> : <WaitlistView funnel={funnel} days={publicDays(days, statesFor(loaded, viewer))} branding={branding} timeZone={timeZone} startAt={decision.startAt} optin={optin} />}
    </PublicShell>
  );
}
