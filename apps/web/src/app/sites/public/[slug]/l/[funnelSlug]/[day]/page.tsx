import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { dayLabel } from "@/features/funnels/data";
import { loadPublicFunnel, publicSiteMatches, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { FunnelShell, NavStrip, funnelIcons } from "@/features/funnels/public-shell";
import { SmsSlot, smsFormFor, type SmsQuery } from "@/features/funnels/sms-slot";
import { ClosedPage, DayView, PreviewBar, previewLabel } from "@/features/funnels/public-view";
import { HomeBlocks } from "@/features/funnels/home-view";
import { offerBlocks } from "@/features/funnels/site-data";

type Params = Promise<{ slug: string; funnelSlug: string; day: string }>;
type Search = Promise<PreviewOptions & SmsQuery & { k?: string }>;

function position(segment: string): number | null {
  const match = /^day-(\d{1,3})$/.exec(segment);
  return match ? Number(match[1]) : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug, day } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicFunnel(slug, funnelSlug, await searchParams) : null;
  const row = loaded?.days.find((item) => item.position === position(day));
  if (!loaded || !row) return { title: { absolute: "Not found" } };
  return { title: { absolute: `${dayLabel(row)}${row.title ? `: ${row.title}` : ""} · ${loaded.funnel.name}` }, icons: funnelIcons(loaded.funnel), robots: loaded.preview ? { index: false, follow: false } : undefined };
}

/** One day of the funnel: /l/<funnel>/day-<n>. The state engine decides what it shows. */
export default async function FunnelDayPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, funnelSlug, day: segment } = await params;
  const query = await searchParams;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicFunnel(slug, funnelSlug, query);
  const wanted = position(segment);
  const day = loaded?.days.find((item) => item.position === wanted);
  if (!loaded || !day) notFound();
  const { funnel, timeZone, preview, now, carry } = loaded;
  const presentedKey = typeof query.k === "string" && /^[a-z0-9-]{1,40}$/.test(query.k) ? query.k : null;
  const ctx = await pageContext(loaded, { fresh: query.fresh, presentedKeys: presentedKey ? { [day.id]: presentedKey } : {} });
  const { base, viewer, states, safeDays, theme } = ctx;
  const closed = states[0]?.kind === "closed";
  // Previews follow the close redirect too, so "preview as of" after the end shows the real behaviour.
  if (closed && funnel.closeMode === "redirect" && funnel.closeRedirectUrl) redirect(funnel.closeRedirectUrl);
  const previewBar = preview ? <PreviewBar asOf={now} label={previewLabel(loaded, query.fresh)} timeZone={timeZone} /> : null;
  const nav = <NavStrip funnel={funnel} days={safeDays} states={states} navItems={loaded.navItems} base={base} carry={carry} currentDayId={day.id} />;
  const sms = smsFormFor(loaded, day.smsFormId);
  // Docuseries: the open module's access window drives the header clock and "episode" countdowns.
  const dayState = states[loaded.days.findIndex((item) => item.id === day.id)];
  // On an expired or upcoming episode, the clock follows the episode that is open now.
  const openExpiry = states.find((state) => state.kind === "video" && state.expiresAt);
  const expiresAt = dayState?.kind === "video" && dayState.expiresAt ? dayState.expiresAt : openExpiry?.kind === "video" ? (openExpiry.expiresAt ?? null) : null;
  const offer = offerBlocks(funnel);
  return (
    <FunnelShell
      theme={theme}
      loaded={loaded}
      viewer={viewer}
      preview={previewBar}
      showDeadline={!closed}
      page={closed ? "close" : "day"}
      base={base}
      nav={closed || funnel.navLayout === "sidebar" ? null : nav}
      episodeExpiresAt={expiresAt}
      reloadTo={preview && query.as_of ? null : `${base}/day-${day.position}${carry}`}
    >
      {closed ? (
        <ClosedPage loaded={loaded} ctx={ctx} />
      ) : (
        <DayView
          loaded={loaded}
          ctx={ctx}
          day={safeDays.find((item) => item.id === day.id)!}
          presentedKey={presentedKey}
          nav={null}
          sms={sms ? <SmsSlot loaded={loaded} form={sms} base={base} back={`${base}/day-${day.position}`} query={query} /> : null}
          offer={offer.length ? <HomeBlocks ctx={{ loaded, theme, viewer, states, days: safeDays, base, origin: ctx.origin, query, host: ctx.host, episodeExpiresAt: expiresAt }} blocks={offer} /> : null}
        />
      )}
    </FunnelShell>
  );
}
