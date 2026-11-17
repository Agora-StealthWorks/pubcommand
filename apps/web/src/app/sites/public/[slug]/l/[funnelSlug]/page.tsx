import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orgPublicUrl } from "@/features/funnels/guard";
import { dayRules, funnelRules } from "@/features/funnels/data";
import { HomeBlocks, HostsSection, agendaEntries } from "@/features/funnels/home-view";
import { loadPublicFunnel, publicSiteMatches, viewerFacts, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { FunnelShell, NavStrip, funnelIcons } from "@/features/funnels/public-shell";
import { SmsSlot, smsFormFor, type SmsQuery } from "@/features/funnels/sms-slot";
import { ClosedView, EmailOptin, FormOptin, PreviewBar, WaitlistView } from "@/features/funnels/public-view";
import { ViewerSync } from "@/features/funnels/public-client";
import { homeBlocks } from "@/features/funnels/site-data";
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
  const { funnel, days, timeZone, preview, now, carry } = loaded;
  const ctx = await pageContext(loaded, { fresh: query.fresh });
  const { base, viewer, theme } = ctx;
  const decision = entryDecision(funnelRules(funnel), days.map(dayRules), viewerFacts(viewer), now);
  if (decision.kind === "day") redirect(`${base}/day-${decision.position}${carry}`);
  if (decision.kind === "closed" && funnel.closeMode === "redirect" && funnel.closeRedirectUrl && !preview) redirect(funnel.closeRedirectUrl);
  const { branding } = theme;
  const previewBar = preview ? <PreviewBar asOf={now} label={[funnel.status === "published" ? "" : "draft", loaded.draftShown ? "unsaved changes" : ""].filter(Boolean).join(", ")} timeZone={timeZone} /> : null;
  const syncUrl = preview ? null : `${base}/sync`;

  if (decision.kind === "closed") {
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} showDeadline={false} page="close" base={base}>
        <ClosedView funnel={funnel} branding={branding} />
      </FunnelShell>
    );
  }

  if (decision.kind === "home") {
    const nav = funnel.homeShell ? <NavStrip funnel={funnel} days={ctx.safeDays} states={ctx.states} navItems={loaded.navItems} base={base} carry={carry} /> : null;
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} nav={nav} page="home" base={base}>
        {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} /> : null}
        <HomeBlocks ctx={{ loaded, theme, viewer, states: ctx.states, days: ctx.safeDays, base, origin: ctx.origin, query, host: ctx.host }} blocks={homeBlocks(funnel)} />
      </FunnelShell>
    );
  }

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
    <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} page="waitlist" base={base}>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} /> : null}
      <WaitlistView
        funnel={funnel}
        days={agendaEntries(ctx.safeDays, loaded.navItems)}
        branding={branding}
        timeZone={timeZone}
        startAt={decision.startAt}
        optin={optin}
        hosts={funnel.hostsEnabled ? <HostsSection funnel={funnel} hosts={loaded.hosts} title={funnel.hostsTitle} /> : null}
      />
    </FunnelShell>
  );
}
