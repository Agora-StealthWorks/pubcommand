import type { ReactNode } from "react";
import { googleCalendarUrl, type CalendarEvent } from "../../../../../modules/funnels/calendar";
import { reactAttrs, splitHeadCode } from "../../../../../modules/funnels/code";
import { deadlineBar, deadlineButtonHref, deadlineShowsOn, deadlineText, type DeadlinePage } from "../../../../../modules/funnels/deadline";
import { RichContentStyles } from "@/components/rich-text-editor/content-css";
import { safeColor } from "../../../../../modules/funnels/checks";
import { navStrip } from "../../../../../modules/funnels/nav";
import type { DayState } from "../../../../../modules/funnels/state";
import { dayLabel, dayThumb, funnelRules, type DayRow, type FunnelRow, type NavItemRow } from "./data";
import type { LoadedFunnel } from "./public";
import { viewerFacts } from "./public";
import type { ViewerCookie } from "../../../../../modules/funnels/viewer";
import { DeadlineBarClient } from "./site-client";
import { navItemThumb, pageHref, type FunnelTheme } from "./site-data";
import { RICH } from "./public-view";

/** Which kind of page a public funnel page is (the deadline bar is set per kind). */
export type FunnelPageKind = DeadlinePage | "close";

/** The deadline ribbon for this viewer, or null. */
export function DeadlineBar({ loaded, viewer, position, page, base = "" }: { loaded: LoadedFunnel; viewer: ViewerCookie | null; position: "top" | "bottom"; page: FunnelPageKind; base?: string }) {
  const { funnel } = loaded;
  const barPosition = funnel.deadlineBarPosition === "top" ? "top" : "bottom";
  if (barPosition !== position) return null;
  if (page === "close" || !deadlineShowsOn(funnel.deadlineBarPages, page)) return null;
  const timing = deadlineBar(
    funnelRules(funnel),
    { enabled: funnel.deadlineBarEnabled, target: funnel.deadlineBarTarget === "start" ? "start" : funnel.deadlineBarTarget === "custom" ? "custom" : "end", at: funnel.deadlineBarAt, withinHours: funnel.deadlineBarWithinHours },
    viewerFacts(viewer),
    loaded.now,
  );
  if (!timing) return null;
  return (
    <DeadlineBarClient
      at={timing.at.getTime()}
      revealAt={timing.revealAt?.getTime() ?? null}
      text={deadlineText(funnel.deadlineBarText, timing.at, loaded.timeZone)}
      bg={safeColor(funnel.deadlineBarBg, "#b42318")}
      color={safeColor(funnel.deadlineBarColor, "#ffffff")}
      position={position}
      sticky={funnel.deadlineBarSticky}
      nowOffset={loaded.preview ? loaded.now.getTime() - Date.now() : 0}
      funnelId={funnel.id}
      dismissible={funnel.deadlineBarDismiss}
      button={funnel.deadlineBarButtonText.trim() ? { text: funnel.deadlineBarButtonText.trim(), href: deadlineButtonHref(funnel.deadlineBarButtonUrl, base, loaded.carry) } : null}
    />
  );
}

/** Header (logo per the design), optional navigation, footer, and the deadline bar, for every public funnel page. */
export function FunnelShell({
  theme,
  loaded,
  viewer,
  preview,
  nav,
  showDeadline = true,
  page,
  base,
  children,
}: {
  theme: FunnelTheme;
  loaded: LoadedFunnel;
  viewer: ViewerCookie | null;
  preview?: ReactNode;
  nav?: ReactNode;
  showDeadline?: boolean;
  /** The page kind, for the deadline bar's "show on" setting. */
  page: FunnelPageKind;
  /** The link base (`/l/<slug>`, or "" on a custom domain). */
  base: string;
  children: ReactNode;
}) {
  const { branding } = theme;
  const logo = branding.logoSrc ? (
    <img src={branding.logoSrc} alt={branding.brandName} className="pcf-logo" />
  ) : (
    <span className="block truncate text-lg font-bold tracking-tight">{branding.brandName}</span>
  );
  return (
    <div className="pcf flex min-h-screen flex-col">
      <style dangerouslySetInnerHTML={{ __html: theme.css }} />
      <RichContentStyles />
      {theme.fontHref ? <link rel="stylesheet" href={theme.fontHref} /> : null}
      <FunnelCode loaded={loaded} where="head" />
      {preview}
      {showDeadline ? <DeadlineBar loaded={loaded} viewer={viewer} position="top" page={page} base={base} /> : null}
      <header className="pcf-header">
        <div className="pcf-header-inner">
          {theme.logoHref ? (
            <a href={theme.logoHref} className="inline-flex max-w-full items-center" aria-label={branding.brandName}>
              {logo}
            </a>
          ) : (
            <span className="inline-flex max-w-full items-center">{logo}</span>
          )}
        </div>
      </header>
      {nav}
      <div className="min-w-0 flex-1">{children}</div>
      <footer className="pcf-footer border-t border-black/10 px-4 py-6 text-center text-xs">
        <div className="mx-auto max-w-3xl space-y-3">
          {theme.footerLogoSrc ? <img src={theme.footerLogoSrc} alt={branding.brandName} className="mx-auto block h-auto w-auto max-w-full" style={{ maxHeight: theme.footerLogoHeight }} /> : null}
          {branding.footerHtml ? <div className={`${RICH} [overflow-wrap:anywhere]`} dangerouslySetInnerHTML={{ __html: branding.footerHtml }} /> : null}
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>© {loaded.now.getFullYear()} {branding.companyName}</span>
            {branding.privacyUrl ? (
              <a href={branding.privacyUrl} target="_blank" rel="noopener noreferrer">
                Privacy policy
              </a>
            ) : null}
            {branding.termsUrl ? (
              <a href={branding.termsUrl} target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            ) : null}
            {theme.footerLinks.map((link) => (
              <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
          </p>
        </div>
      </footer>
      {showDeadline ? <DeadlineBar loaded={loaded} viewer={viewer} position="bottom" page={page} base={base} /> : null}
      <FunnelCode loaded={loaded} where="footer" />
    </div>
  );
}

/**
 * The funnel's header / footer code (admin-pasted tracking code). Public
 * visitors only: never in previews, the builder's live preview or time travel.
 * <meta>/<link> tags are rendered as head elements (React hoists them); the
 * rest is placed as is, so its scripts run when the page loads.
 */
export function FunnelCode({ loaded, where }: { loaded: LoadedFunnel; where: "head" | "footer" }) {
  if (loaded.preview) return null;
  const code = where === "head" ? loaded.funnel.headCode : loaded.funnel.footerCode;
  if (!code.trim()) return null;
  if (where === "footer") return <div data-funnel-code="footer" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: code }} />;
  const { headTags, bodyHtml } = splitHeadCode(code);
  return (
    <>
      {headTags.map((item, index) => (item.tag === "meta" ? <meta key={`m${index}`} {...reactAttrs(item.attrs)} /> : <link key={`l${index}`} {...reactAttrs(item.attrs)} />))}
      {bodyHtml ? <div data-funnel-code="head" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : null}
    </>
  );
}

/** Browser-tab icon for every public funnel page (Next metadata). */
export function funnelIcons(funnel: Pick<FunnelRow, "slug" | "faviconAssetId" | "faviconUrl" | "updatedAt">): { icon: string } | undefined {
  if (funnel.faviconAssetId) return { icon: `/l/${funnel.slug}/asset/${funnel.faviconAssetId}?v=${funnel.updatedAt.getTime()}` };
  if (funnel.faviconUrl && /^https:\/\//i.test(funnel.faviconUrl)) return { icon: funnel.faviconUrl };
  return undefined;
}

function LockBadge() {
  return (
    <span className="pcf-lock absolute inset-0 items-center justify-center bg-black/40 text-white" aria-label="Locked">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
      </svg>
    </span>
  );
}

function Tile({ href, newTab, current, locked, faded, thumb, label, sub, badge }: { href: string | null; newTab?: boolean; current?: boolean; locked?: boolean; faded?: boolean; thumb: string | null; label: string; sub?: string; badge?: ReactNode }) {
  const body = (
    <>
      <span className="pcf-thumb relative block bg-black/80" style={{ aspectRatio: "16 / 9" }}>
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center px-2 text-center text-sm font-bold text-white">{locked ? "" : label}</span>}
        {locked ? <LockBadge /> : null}
        {badge}
      </span>
      <span className="pcf-tile-label mt-1.5 block truncate text-xs font-semibold">{label}</span>
      {sub ? <span className="block truncate text-xs opacity-80">{sub}</span> : null}
    </>
  );
  const common = { className: "pcf-tile block shrink-0", "data-locked": locked ? "1" : undefined, style: faded ? { opacity: 0.5 } : undefined, "aria-current": current ? ("page" as const) : undefined };
  if (!href) {
    return (
      <li>
        <span {...common} aria-disabled="true">
          {body}
        </span>
      </li>
    );
  }
  return (
    <li>
      <a href={href} {...common} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {body}
      </a>
    </li>
  );
}

/** The navigation strip: module tiles with pages, links and placeholders placed among them. */
export function NavStrip({
  funnel,
  days,
  states,
  navItems,
  base,
  carry,
  currentDayId,
  currentPageSlug,
}: {
  funnel: FunnelRow;
  days: DayRow[];
  states: DayState[];
  navItems: NavItemRow[];
  base: string;
  carry: string;
  currentDayId?: string;
  currentPageSlug?: string;
}) {
  const entries = navStrip(days, navItems);
  if (!entries.length) return null;
  return (
    <nav aria-label="Navigation" className="pcf-nav">
      <ol className="mx-auto flex max-w-5xl gap-3 overflow-x-auto px-4 pb-3 pt-5">
        {entries.map((entry) => {
          if (entry.kind === "day") {
            const { day } = entry;
            const state = states[entry.index]!;
            const open = state.kind !== "locked" && state.kind !== "closed";
            return (
              <Tile
                key={day.id}
                href={`${base}/day-${day.position}${carry}`}
                current={day.id === currentDayId}
                locked={!open}
                thumb={dayThumb(day, base, state.kind === "video")}
                label={dayLabel(day)}
                sub={day.title || undefined}
                badge={state.kind === "live" ? <span className="absolute left-1.5 top-1.5 rounded bg-[#d92d20] px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span> : null}
              />
            );
          }
          const { item } = entry;
          const label = item.label.trim() || item.title.trim() || (item.kind === "placeholder" ? "Coming soon" : item.kind === "link" ? "Link" : "Page");
          const thumb = navItemThumb(funnel, item);
          if (item.kind === "placeholder") return <Tile key={item.id} href={null} locked={item.showLock} faded={item.faded} thumb={thumb} label={label} sub={item.agendaWhen || undefined} />;
          if (item.kind === "link") return <Tile key={item.id} href={item.url} newTab={item.newTab} thumb={thumb} label={`${label} ↗`} />;
          return <Tile key={item.id} href={pageHref(funnel, base, item.slug, carry)} current={item.slug === currentPageSlug} thumb={thumb} label={label} sub={item.title && item.title !== label ? item.title : undefined} />;
        })}
      </ol>
    </nav>
  );
}

/** Add to calendar: Google Calendar link and an .ics download (Apple Calendar, Outlook). */
export function AddToCalendar({ event, icsHref, timeZone, tone = "light" }: { event: CalendarEvent; icsHref: string; timeZone: string; tone?: "light" | "dark" }) {
  const style = tone === "dark" ? { borderColor: "#ffffff", color: "#ffffff" } : undefined;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <a href={googleCalendarUrl(event, timeZone)} target="_blank" rel="noopener noreferrer" className="pcf-btn-quiet text-sm" style={style}>
        Add to Google Calendar
      </a>
      <a href={icsHref} className="pcf-btn-quiet text-sm" style={style} download>
        Apple / Outlook (.ics)
      </a>
    </div>
  );
}
