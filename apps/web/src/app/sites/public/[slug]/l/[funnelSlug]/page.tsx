import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orgPublicUrl } from "@/features/funnels/guard";
import { HomeBlocks, HostsSection } from "@/features/funnels/home-view";
import { dayRulesOf, loadPublicFunnel, publicSiteMatches, rulesOf, viewerFacts, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { FunnelShell, NavStrip, funnelIcons } from "@/features/funnels/public-shell";
import { SmsSlot, smsFormFor, type SmsQuery } from "@/features/funnels/sms-slot";
import { ClosedPage, EmailOptin, FormOptin, PreviewBar, WaitlistView, previewLabel } from "@/features/funnels/public-view";
import { ClickTracker, ViewerSync } from "@/features/funnels/public-client";
import { homeBlocks } from "@/features/funnels/site-data";
import { trackedCarry } from "@/features/funnels/tracking-data";
import { CustomPageView, customPageNav } from "@/features/funnels/custom-page-view";
import { entryDecision } from "../../../../../../../../../modules/funnels/state";

type Params = Promise<{ slug: string; funnelSlug: string }>;
type Search = Promise<PreviewOptions & SmsQuery & { joined?: string; error?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicFunnel(slug, funnelSlug, await searchParams) : null;
  if (!loaded) return { title: { absolute: "Not found" } };
  const title = loaded.funnel.siteType === "microsite" && loaded.funnel.homeTitle.trim() ? loaded.funnel.homeTitle.trim() : loaded.funnel.name;
  return { title: { absolute: title }, icons: funnelIcons(loaded.funnel), robots: loaded.preview || loaded.funnel.status !== "published" ? { index: false, follow: false } : undefined };
}

/** The funnel's front door: a microsite's home page, the waitlist countdown, the right day, or the close page. */
export default async function FunnelEntryPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, funnelSlug } = await params;
  const query = await searchParams;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicFunnel(slug, funnelSlug, query);
  if (!loaded) notFound();
  const { funnel, timeZone, preview, now, carry } = loaded;
  const ctx = await pageContext(loaded, { fresh: query.fresh });
  const { base, viewer, theme } = ctx;
  const entry = entryDecision(rulesOf(loaded), dayRulesOf(loaded), viewerFacts(viewer), now);
  // A launch funnel's custom page set as the home page replaces the waitlist / module redirect at the front door.
  const homePage = funnel.siteType !== "microsite" ? loaded.navItems.find((item) => item.kind === "page" && item.isHome) : undefined;
  const decision = homePage && entry.kind !== "closed" ? ({ kind: "custom" } as const) : entry;
  if (decision.kind === "day") redirect(`${base}/day-${decision.position}${carry || (await trackedCarry(loaded.organizationId, query))}`);
  // Previews follow the close redirect too, so "preview as of" after the end shows the real behaviour.
  if (decision.kind === "closed" && funnel.closeMode === "redirect" && funnel.closeRedirectUrl) redirect(funnel.closeRedirectUrl);
  const { branding } = theme;
  const previewBar = preview ? <PreviewBar asOf={now} label={previewLabel(loaded, query.fresh)} timeZone={timeZone} /> : null;
  const syncUrl = preview ? null : `${base}/sync`;

  if (decision.kind === "closed") {
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} showDeadline={false} page="close" base={base}>
        <ClosedPage loaded={loaded} ctx={ctx} />
      </FunnelShell>
    );
  }

  if (decision.kind === "custom" && homePage) {
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} nav={customPageNav(loaded, ctx, homePage)} page="custom" base={base}>
        <CustomPageView loaded={loaded} ctx={ctx} item={homePage} query={query} orgSlug={slug} />
      </FunnelShell>
    );
  }

  if (decision.kind === "home") {
    const nav = funnel.homeShell ? <NavStrip funnel={funnel} days={ctx.safeDays} states={ctx.states} navItems={loaded.navItems} base={base} carry={carry} /> : null;
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} nav={nav} page="home" base={base}>
        {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} page="home" /> : null}
        <ClickTracker syncUrl={syncUrl} dayId={null} page="home" />
        <HomeBlocks ctx={{ loaded, theme, viewer, states: ctx.states, days: ctx.safeDays, base, origin: ctx.origin, query, host: ctx.host }} blocks={homeBlocks(funnel)} />
      </FunnelShell>
    );
  }

  if (decision.kind !== "waitlist") notFound();
  let optin = null;
  if (funnel.optinMode === "email") {
    optin = <EmailOptin funnel={funnel} branding={branding} action={`${base || `/l/${funnel.slug}`}/optin`} back={base || "/"} joined={query.joined === "1"} error={query.error} />;
  } else if (funnel.optinMode === "form" && funnel.optinFormSlug) {
    optin = <FormOptin src={orgPublicUrl(ctx.host, slug, `/embed/${funnel.optinFormSlug}`)} headline={funnel.optinHeadline} />;
  } else if (funnel.optinMode === "sms") {
    const sms = smsFormFor(loaded, funnel.optinSmsFormId);
    optin = sms ? <SmsSlot loaded={loaded} form={sms} base={base} back={base || "/"} query={query} /> : null;
  }
  return (
    <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} page="waitlist" base={base} hideHeader>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} page="waitlist" /> : null}
      <ClickTracker syncUrl={syncUrl} dayId={null} page="waitlist" />
      <WaitlistView
        loaded={loaded}
        ctx={ctx}
        days={ctx.agenda}
        startAt={decision.startAt}
        optin={optin}
        hosts={funnel.hostsEnabled ? <HostsSection funnel={funnel} hosts={loaded.hosts} title={funnel.hostsTitle} bg={funnel.hostsBg} titleColor={funnel.hostsTitleColor} /> : null}
      />
    </FunnelShell>
  );
}
