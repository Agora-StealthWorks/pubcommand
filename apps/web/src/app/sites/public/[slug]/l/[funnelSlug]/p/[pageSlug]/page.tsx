import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isClosed } from "../../../../../../../../../../../modules/funnels/state";
import { funnelRules } from "@/features/funnels/data";
import { loadPublicFunnel, publicSiteMatches, viewerFacts, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { FunnelShell, funnelIcons } from "@/features/funnels/public-shell";
import type { SmsQuery } from "@/features/funnels/sms-slot";
import { ClosedPage, PreviewBar, previewLabel } from "@/features/funnels/public-view";
import { CustomPageView, customPageNav } from "@/features/funnels/custom-page-view";

type Params = Promise<{ slug: string; funnelSlug: string; pageSlug: string }>;
type Search = Promise<PreviewOptions & SmsQuery & { joined?: string; error?: string }>;

async function load(slug: string, funnelSlug: string, pageSlug: string, query: PreviewOptions) {
  if (!/^[a-z0-9-]{1,60}$/.test(pageSlug) || !(await publicSiteMatches(slug))) return null;
  const loaded = await loadPublicFunnel(slug, funnelSlug, query);
  const item = loaded?.navItems.find((row) => row.kind === "page" && row.slug === pageSlug);
  return loaded && item ? { loaded, item } : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug, pageSlug } = await params;
  const found = await load(slug, funnelSlug, pageSlug, await searchParams);
  if (!found) return { title: { absolute: "Not found" } };
  return { title: { absolute: `${found.item.title || found.item.label || "Page"} · ${found.loaded.funnel.name}` }, icons: funnelIcons(found.loaded.funnel), robots: found.loaded.preview ? { index: false, follow: false } : undefined };
}

/** A custom page: /l/<funnel>/p/<page>. Rich text in the content box, or admin HTML in a sandbox; optional opt-in under it. */
export default async function FunnelCustomPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, funnelSlug, pageSlug } = await params;
  const query = await searchParams;
  const found = await load(slug, funnelSlug, pageSlug, query);
  if (!found) notFound();
  const { loaded, item } = found;
  const { funnel, timeZone, preview, now } = loaded;
  const ctx = await pageContext(loaded, { fresh: query.fresh });
  const { base, viewer, theme } = ctx;
  const closed = isClosed(funnelRules(funnel), viewerFacts(viewer), now);
  if (closed && funnel.closeMode === "redirect" && funnel.closeRedirectUrl) redirect(funnel.closeRedirectUrl);
  const previewBar = preview ? <PreviewBar asOf={now} label={previewLabel(loaded, query.fresh)} timeZone={timeZone} /> : null;
  if (closed) {
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} showDeadline={false} page="close" base={base}>
        <ClosedPage loaded={loaded} ctx={ctx} />
      </FunnelShell>
    );
  }
  return (
    <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} nav={customPageNav(loaded, ctx, item)} page="custom" base={base}>
      <CustomPageView loaded={loaded} ctx={ctx} item={item} query={query} orgSlug={slug} />
    </FunnelShell>
  );
}
