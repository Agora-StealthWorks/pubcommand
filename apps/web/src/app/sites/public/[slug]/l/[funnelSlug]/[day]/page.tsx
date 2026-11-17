import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { dayLabel, funnelRules } from "@/features/funnels/data";
import { loadPublicFunnel, publicSiteMatches, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { AddToCalendar, FunnelShell, NavStrip } from "@/features/funnels/public-shell";
import { ClosedView, DayView, PreviewBar } from "@/features/funnels/public-view";
import { liveSessionEvent } from "../../../../../../../../../../modules/funnels/calendar";

type Params = Promise<{ slug: string; funnelSlug: string; day: string }>;
type Search = Promise<PreviewOptions & { k?: string }>;

function position(segment: string): number | null {
  const match = /^day-(\d{1,3})$/.exec(segment);
  return match ? Number(match[1]) : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug, day } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicFunnel(slug, funnelSlug, await searchParams) : null;
  const row = loaded?.days.find((item) => item.position === position(day));
  if (!loaded || !row) return { title: { absolute: "Not found" } };
  return { title: { absolute: `${dayLabel(row)}${row.title ? `: ${row.title}` : ""} · ${loaded.funnel.name}` }, robots: loaded.preview ? { index: false, follow: false } : undefined };
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
  if (closed && funnel.closeMode === "redirect" && funnel.closeRedirectUrl && !preview) redirect(funnel.closeRedirectUrl);
  const previewBar = preview ? <PreviewBar asOf={now} label={[funnel.status === "published" ? "" : "draft", loaded.draftShown ? "unsaved changes" : ""].filter(Boolean).join(", ")} timeZone={timeZone} /> : null;
  const index = loaded.days.findIndex((item) => item.id === day.id);
  const state = states[index];
  const rules = funnelRules(funnel);
  // Add to calendar on a live session that has not started yet.
  const upcomingLive = state?.kind === "locked" && rules.mode === "live" && day.isLive && day.liveStartAt && day.liveStartAt > now;
  const event = upcomingLive
    ? liveSessionEvent({ funnelId: funnel.id, funnelName: funnel.name, day: { ...day, label: dayLabel(day) }, roomUrl: rules.livestreamUrl, pageUrl: `${ctx.origin}/l/${funnel.slug}/day-${day.position}`, timeZone })
    : null;
  const nav = <NavStrip funnel={funnel} days={safeDays} states={states} navItems={loaded.navItems} base={base} carry={carry} currentDayId={day.id} />;
  return (
    <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} showDeadline={!closed}>
      {closed ? (
        <ClosedView funnel={funnel} branding={theme.branding} />
      ) : (
        <DayView
          funnel={funnel}
          days={safeDays}
          states={states}
          day={safeDays.find((item) => item.id === day.id)!}
          branding={theme.branding}
          timeZone={timeZone}
          base={base}
          carry={carry}
          syncUrl={preview ? null : `${base}/sync`}
          presentedKey={presentedKey}
          now={now}
          preview={preview}
          nav={nav}
          calendar={event ? <AddToCalendar event={event} icsHref={`${base || `/l/${funnel.slug}`}/ics?day=${day.id}`} timeZone={timeZone} tone="dark" /> : null}
        />
      )}
    </FunnelShell>
  );
}
