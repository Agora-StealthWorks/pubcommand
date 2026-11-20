import type { ReactNode } from "react";
import { googleCalendarUrl, type CalendarEvent } from "../../../../../modules/funnels/calendar";
import { reactAttrs, splitHeadCode } from "../../../../../modules/funnels/code";
import { deadlineBar, deadlineButtonHref, deadlineShowsOn, deadlineText, type DeadlinePage } from "../../../../../modules/funnels/deadline";
import { RichContentStyles } from "@/components/rich-text-editor/content-css";
import { safeColor } from "../../../../../modules/funnels/checks";
import { navStrip } from "../../../../../modules/funnels/nav";
import type { DayState } from "../../../../../modules/funnels/state";
import { dayLabel, dayThumb, funnelRules, isTextModule, type DayRow, type FunnelRow, type NavItemRow } from "./data";
import type { LoadedFunnel } from "./public";
import { viewerFacts } from "./public";
import type { ViewerCookie } from "../../../../../modules/funnels/viewer";
import { DeadlineBarClient } from "./site-client";
import { navItemThumb, pageHref, type FunnelTheme } from "./site-data";
import { RICH } from "./public-view";
import { LAYOUT_CSS } from "../../../../../modules/funnels/layout-css";

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
      digitColor={funnel.deadlineBarDigitColor && /^#[0-9a-f]{6}$/i.test(funnel.deadlineBarDigitColor) ? funnel.deadlineBarDigitColor : null}
      buttonBg={funnel.deadlineBarButtonBg && /^#[0-9a-f]{6}$/i.test(funnel.deadlineBarButtonBg) ? funnel.deadlineBarButtonBg : null}
      spacing={funnel.deadlineBarSpacing === "wide" ? "wide" : "narrow"}
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
  hideHeader = false,
}: {
  /** The waitlist draws its logo inside the countdown hero instead of a header bar. */
  hideHeader?: boolean;
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
      <style dangerouslySetInnerHTML={{ __html: `${LAYOUT_CSS}\n${theme.css}` }} />
      <RichContentStyles />
      {theme.fontHref ? <link rel="stylesheet" href={theme.fontHref} /> : null}
      <FunnelCode loaded={loaded} where="head" />
      {preview}
      {showDeadline ? <DeadlineBar loaded={loaded} viewer={viewer} position="top" page={page} base={base} /> : null}
{hideHeader ? null : (
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
      )}
      {nav}
      <main className="pcf-main">{children}</main>
      <footer className="pcf-footer">
        <div className="pcf-wrap space-y-3">
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
    <span className="pcf-lock" role="img" aria-label="Locked">
      <span className="pcf-lock-badge">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
      </svg>
      </span>
    </span>
  );
}

function Tile({ href, newTab, current, locked, faded, thumb, label, placeholder, badge, track }: { href: string | null; newTab?: boolean; current?: boolean; locked?: boolean; faded?: boolean; thumb: string | null; label: string; placeholder?: ReactNode; badge?: ReactNode; track?: { kind: string; target: string } }) {
  const body = (
    <>
      <span className="pcf-thumb">
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : placeholder ?? <span className="pcf-ph" />}
        {locked ? <LockBadge /> : null}
        {badge}
      </span>
      <span className="pcf-tile-label">{label}</span>
    </>
  );
  const common = { className: "pcf-tile", "data-locked": locked ? "1" : undefined, style: faded ? { opacity: 0.45 } : undefined, "aria-current": current ? ("page" as const) : undefined, title: label };
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
      <a href={href} {...common} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...(track ? { "data-track": track.kind, "data-track-target": track.target } : {})}>
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
    <nav aria-label="Modules" className="pcf-nav">
      <ol className="pcf-wrap pcf-nav-row">
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
                placeholder={<span className="pcf-ph">{isTextModule(day, funnel.mode) ? "📝" : day.position}</span>}
                badge={state.kind === "live" ? <span className="pcf-live-badge">LIVE</span> : null}
              />
            );
          }
          const { item } = entry;
          const label = item.label.trim() || item.title.trim() || (item.kind === "placeholder" ? "Coming soon" : item.kind === "link" ? "Link" : "Page");
          const thumb = navItemThumb(funnel, item);
          if (item.kind === "placeholder") return <Tile key={item.id} href={null} locked={item.showLock} faded={item.faded} thumb={thumb} label={label} />;
          if (item.kind === "link") return <Tile key={item.id} href={item.url} newTab={item.newTab} thumb={thumb} label={label} placeholder={<span className="pcf-ph is-custom">🔗</span>} track={{ kind: "nav_link", target: `${label}|${item.url}` }} />;
          return <Tile key={item.id} href={pageHref(funnel, base, item.slug, carry)} current={item.slug === currentPageSlug} thumb={thumb} label={label} placeholder={<span className="pcf-ph is-custom">📄</span>} />;
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
