import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { dayLabel, funnelBranding } from "@/features/funnels/data";
import { loadPublicFunnel, publicBase, publicDays, publicSiteMatches, readViewer, statesFor, type PreviewOptions } from "@/features/funnels/public";
import { ClosedView, DayView, PreviewBar, PublicShell } from "@/features/funnels/public-view";

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
  const { funnel, days, timeZone, preview, now, carry } = loaded;
  const base = await publicBase("l", funnelSlug);
  const viewer = await readViewer(funnel.id, preview && query.fresh === "1");
  const presentedKey = typeof query.k === "string" && /^[a-z0-9-]{1,40}$/.test(query.k) ? query.k : null;
  const states = statesFor(loaded, viewer, presentedKey ? { [day.id]: presentedKey } : {});
  const closed = states[0]?.kind === "closed";
  const safeDays = publicDays(days, states);
  if (closed && funnel.closeMode === "redirect" && funnel.closeRedirectUrl && !preview) redirect(funnel.closeRedirectUrl);
  const branding = await funnelBranding(loaded.organizationId, funnel, base);
  const previewBar = preview ? <PreviewBar asOf={now} label={funnel.status === "published" ? "" : "draft"} timeZone={timeZone} /> : null;
  return (
    <PublicShell branding={branding} homeHref={`${base || "/"}${carry}`} preview={previewBar}>
      {closed ? (
        <ClosedView funnel={funnel} branding={branding} />
      ) : (
        <DayView
          funnel={funnel}
          days={safeDays}
          states={states}
          day={safeDays.find((item) => item.id === day.id)!}
          branding={branding}
          timeZone={timeZone}
          base={base}
          carry={carry}
          syncUrl={preview ? null : `${base}/sync`}
          presentedKey={presentedKey}
          now={now}
          preview={preview}
        />
      )}
    </PublicShell>
  );
}
