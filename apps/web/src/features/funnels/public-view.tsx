import type { ReactNode } from "react";
import { isHexColor } from "../../../../../modules/funnels/checks";
import { linkItems, type LinkItem } from "../../../../../modules/funnels/links";
import { dayKey, earlierPendingSession, effectiveStart, fillLockMessage, isLiveNow, isOpen, scheduledUnlock } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { formatZonedDateLong } from "../../../../../modules/funnels/links";
import { formatTimeOnly } from "../../../../../modules/funnels/links";
import { dayLabel, dayThumb, dayVideo, emailConsent, isTextModule, hasBody, type Branding, type DayRow, type FunnelRow } from "./data";
import { ClickTracker, Countdown, CtaButton, DayVideo, EarlyJoin, FormEmbed, LiveRedirect, TextProgress, TrackedLink, UnlockRefresh, ViewerSync } from "./public-client";
import { SessionCalendar, upcomingSessions } from "./calendar-view";
import { dayRulesOf, rulesOf, viewerFacts, type LoadedFunnel } from "./public";
import type { PageContext } from "./public-context";
import { EpisodeList } from "./episode-list";
import { sanitizeEmbed, sanitizeRich } from "./sanitize";

/** Typography for sanitized rich text (no shared CSS file is touched). */
export const RICH = "[&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-bold [&_img]:h-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** Header (logo or brand name) and footer (rich footer, privacy and terms) for every public page. */
export function PublicShell({ branding, homeHref, children, preview }: { branding: Branding; homeHref: string; children: ReactNode; preview?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: branding.pageBg, color: branding.textColor }}>
      {preview}
      <header style={{ background: branding.headerBg, color: branding.headerText }}>
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-3.5">
          <a href={homeHref} className="inline-flex max-w-full items-center" aria-label={branding.brandName}>
            {branding.logoSrc ? (
              <img src={branding.logoSrc} alt={branding.brandName} style={{ height: branding.logoHeight, maxWidth: "100%", width: "auto", objectFit: "contain", flex: "none" }} />
            ) : (
              <span className="truncate text-lg font-bold tracking-tight">{branding.brandName}</span>
            )}
          </a>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-black/10 bg-white/60 px-4 py-6 text-center text-xs" style={{ color: branding.textColor }}>
        <div className="mx-auto max-w-3xl space-y-2">
          {branding.footerHtml ? <div className={`${RICH} [overflow-wrap:anywhere]`} dangerouslySetInnerHTML={{ __html: branding.footerHtml }} /> : null}
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>© {new Date().getFullYear()} {branding.companyName}</span>
            {branding.privacyUrl ? (
              <a href={branding.privacyUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Privacy policy
              </a>
            ) : null}
            {branding.termsUrl ? (
              <a href={branding.termsUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            ) : null}
          </p>
        </div>
      </footer>
    </div>
  );
}

export function PreviewBar({ asOf, label, timeZone, editHref }: { asOf: Date; label: string; timeZone: string; editHref?: string }) {
  return (
    <div className="bg-[#fef0c7] px-4 py-2 text-center text-xs font-semibold text-[#93370d]">
      Preview{label ? ` · ${label}` : ""} · as of {formatZoned(asOf, timeZone, { weekday: false })}. Visitors do not see this bar, and nothing here is counted.
      {editHref ? (
        <a href={editHref} className="ml-2 underline">
          Back to the builder
        </a>
      ) : null}
    </div>
  );
}

export function Rich({ html, className = "" }: { html: string; className?: string }) {
  const clean = sanitizeRich(html);
  if (!clean) return null;
  return <div className={`${RICH} rte-content [overflow-wrap:anywhere] ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function Button({ href, branding, children, syncUrl, dayId }: { href: string; branding: Branding; children: ReactNode; syncUrl?: string | null; dayId?: string | null }) {
  // .pcf-btn comes from the design CSS (radius, fill or outline); the inline colours cover pages outside a funnel shell.
  const className = "pcf-btn text-base shadow-sm transition";
  const style = { background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor };
  if (syncUrl !== undefined) {
    return (
      <TrackedLink href={href} syncUrl={syncUrl} dayId={dayId ?? null} className={className} style={style}>
        {children}
      </TrackedLink>
    );
  }
  return (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  );
}

/** When a module opens, if the funnel knows it (agenda and locked messages). */
export function dayWhen(funnel: FunnelRow, day: DayRow, start?: Date | null): Date | null {
  if (funnel.mode === "live" && day.isLive && day.liveStartAt) return day.liveStartAt;
  if (funnel.progression === "scheduled") return scheduledUnlock(day, start !== undefined ? start : funnel.timing === "fixed" || funnel.mode === "live" ? funnel.startAt : null);
  if (day.position === 1 && (funnel.timing === "fixed" || funnel.mode === "live")) return funnel.startAt;
  return null;
}

export type AgendaPlaceholder = { id: string; label: string; title: string; agendaWhen: string; agendaDesc: string; faded: boolean };

const colorOr = (value: string | null | undefined, fallback?: string) => (isHexColor(value) ? value!.trim() : fallback);

/** Buttons and text links (resources, homework). Clicks are tracked as "resource". */
export function LinkList({ items, branding, dayId, dark }: { items: LinkItem[]; branding: Branding; dayId?: string | null; dark?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className="pcf-res-list">
      {items.map((item, index) => {
        const target = `${index}|${item.label}|${item.url}`.slice(0, 600);
        const common = { href: item.url, "data-track": "resource", "data-track-target": target, ...(dayId ? { "data-track-day": dayId } : {}), ...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" }) };
        if (item.style === "locked") {
          return (
            <li key={index} className="max-w-full">
              <a href={item.url} data-track="offer" data-track-target={item.label} {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="pcf-dl is-locked [overflow-wrap:anywhere]">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {item.label}
              </a>
            </li>
          );
        }
        return (
          <li key={index} className="max-w-full">
            {item.style === "link" ? (
              <a {...common} className="pcf-res-link underline [overflow-wrap:anywhere]" style={dark ? { color: "inherit" } : undefined}>
                {item.label}
              </a>
            ) : (
              <a {...common} className="pcf-btn [overflow-wrap:anywhere]" style={{ background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor }}>
                <span aria-hidden="true">📄</span>&nbsp;{item.label}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The agenda: modules in order (with placeholders placed among them), each
 * with its date and topics. One component for the waitlist section, the box
 * under a module's video and the home page list block, so they never drift.
 */
export function Agenda({
  funnel,
  days,
  timeZone,
  current,
  title,
  layout,
  start,
  bg,
  text,
  boxed,
  linkFor,
  thumbFor,
  calendarFor,
}: {
  funnel: FunnelRow;
  days: (DayRow | AgendaPlaceholder)[];
  timeZone: string;
  current?: string;
  title?: string;
  /** list (date, title, topics) | cards (thumbnail cards). Default: the funnel's choice. */
  layout?: "list" | "cards";
  /** The viewer's start (per-viewer scheduled dates). */
  start?: Date | null;
  bg?: string;
  text?: string;
  /** A box under a module's video rather than a full-width section. */
  boxed?: boolean;
  linkFor?: (day: DayRow) => string | null;
  thumbFor?: (day: DayRow) => string | null;
  calendarFor?: (day: DayRow) => ReactNode;
}) {
  if (!days.length) return null;
  const cards = (layout ?? (funnel.agendaLayout === "cards" ? "cards" : "list")) === "cards";
  const heading = title ?? funnel.agendaTitle;
  const style = { ...(bg ? { background: bg } : {}), ...(text ? { color: text } : {}) };
  const tags = (day: DayRow, isCurrent: boolean) => (
    <>
      {funnel.mode === "live" && day.isLive ? <span className="pcf-tag">Live</span> : null}
      {isCurrent ? <span className="pcf-tag is-here">You are here</span> : null}
    </>
  );
  const list = cards ? (
    <ol className="pcf-sched">
      {days.map((entry) => {
        if (!("position" in entry)) {
          return (
            <li key={entry.id} className="pcf-sched-item" style={entry.faded ? { opacity: 0.8 } : undefined}>
              <div className="pcf-sched-body">
                <div className="pcf-sched-eyebrow">
                  {entry.label || "Coming soon"}
                  {entry.agendaWhen ? ` · ${entry.agendaWhen}` : ""}
                </div>
                <h3 className="pcf-sched-title">{entry.title || entry.label || "Coming soon"}</h3>
                {entry.agendaDesc ? <p className="text-[15px] opacity-85">{entry.agendaDesc}</p> : null}
              </div>
            </li>
          );
        }
        const day = entry;
        const when = dayWhen(funnel, day, start);
        const isCurrent = current === day.id;
        const href = linkFor && !isCurrent ? linkFor(day) : null;
        const thumb = thumbFor ? thumbFor(day) : null;
        const label = day.title || dayLabel(day);
        return (
          <li key={day.id} className={`pcf-sched-item${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "step" : undefined}>
            {thumb ? (
              <a className="pcf-sched-thumb" href={href ?? undefined} {...(href ? { "data-track": "agenda_link", "data-track-target": dayLabel(day) } : {})}>
                <img src={thumb} alt={label} loading="lazy" />
              </a>
            ) : null}
            <div className="pcf-sched-body">
              <div className="pcf-sched-eyebrow">
                {dayLabel(day)}
                {when ? ` · ${formatZonedDateLong(when, timeZone)}` : ""}
                {tags(day, isCurrent)}
              </div>
              <h3 className="pcf-sched-title">
                {href ? (
                  <a href={href} data-track="agenda_link" data-track-target={dayLabel(day)}>
                    {label}
                  </a>
                ) : (
                  label
                )}
              </h3>
              {day.topics.length === 1 ? <p className="text-[15px] opacity-85">{day.topics[0]}</p> : null}
              {day.topics.length > 1 ? (
                <ul className="pcf-agenda-topics list-disc">
                  {day.topics.map((topic, index) => (
                    <li key={index}>{topic}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <ol className="pcf-agenda-list">
      {days.map((entry) => {
        if (!("position" in entry)) {
          return (
            <li key={entry.id} className={`pcf-agenda-item${entry.faded ? " is-faded" : ""}`}>
              <div className="pcf-agenda-day">{entry.label || "Coming soon"}</div>
              <div className="pcf-agenda-body">
                <h3 className="pcf-agenda-title">{entry.title || entry.label || "Coming soon"}</h3>
                {entry.agendaWhen ? <div className="pcf-agenda-when">{entry.agendaWhen}</div> : null}
                {entry.agendaDesc ? <p className="text-[15px] opacity-85">{entry.agendaDesc}</p> : null}
              </div>
            </li>
          );
        }
        const day = entry;
        const when = dayWhen(funnel, day, start);
        const isCurrent = current === day.id;
        const href = linkFor && !isCurrent ? linkFor(day) : null;
        const label = day.title || dayLabel(day);
        return (
          <li key={day.id} className={`pcf-agenda-item${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "step" : undefined}>
            <div className="pcf-agenda-day">{dayLabel(day)}</div>
            <div className="pcf-agenda-body">
              <h3 className="pcf-agenda-title">
                {href ? (
                  <a href={href} data-track="agenda_link" data-track-target={dayLabel(day)}>
                    {label}
                  </a>
                ) : (
                  label
                )}
                {tags(day, isCurrent)}
              </h3>
              {when ? <div className="pcf-agenda-when">{formatZoned(when, timeZone)}</div> : null}
              {calendarFor ? calendarFor(day) : null}
              {day.topics.length ? (
                <ul className="pcf-agenda-topics list-disc">
                  {day.topics.map((topic, index) => (
                    <li key={index}>{topic}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
  if (boxed) {
    return (
      <section className="pcf-agenda-box" style={style}>
        {heading ? <h2 className="pcf-agenda-h">{heading}</h2> : null}
        {list}
      </section>
    );
  }
  return (
    <section className="pcf-agenda" style={style}>
      <div className="pcf-wrap">
        {heading ? <h2 className="pcf-agenda-h">{heading}</h2> : null}
        {list}
      </div>
    </section>
  );
}

export function EmailOptin({
  funnel,
  branding,
  action,
  back,
  joined,
  error,
  headline,
  buttonText,
  idSuffix = "",
}: {
  funnel: FunnelRow;
  branding: Branding;
  action: string;
  back: string;
  joined: boolean;
  error?: string;
  headline?: string;
  buttonText?: string;
  idSuffix?: string;
}) {
  if (joined) {
    return <p className="rounded-lg bg-black/5 px-4 py-3 text-center text-sm font-semibold">You're on the list. We'll be in touch.</p>;
  }
  const inputId = `optin-email${idSuffix}`;
  const heading = headline ?? funnel.optinHeadline;
  return (
    <form action={action} method="post" className="mx-auto w-full max-w-md space-y-2 text-left">
      {heading ? <p className="text-center text-base font-semibold">{heading}</p> : null}
      {error ? <p className="rounded-md bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{error}</p> : null}
      <input type="hidden" name="back" value={back} />
      <div aria-hidden="true" className="hidden">
        <label>
          Leave empty <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Email address
        </label>
        <input id={inputId} name="email" type="email" required autoComplete="email" placeholder="Your email address" className="h-12 min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 text-base text-[#111827]" />
        <button type="submit" className="pcf-btn h-12 text-base" style={{ background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor }}>
          {buttonText ?? funnel.optinButtonText}
        </button>
      </div>
      <p className="text-center text-xs opacity-80">
        {emailConsent(funnel, branding)}
        {branding.privacyUrl ? (
          <>
            {" "}
            <a href={branding.privacyUrl} className="underline" target="_blank" rel="noopener noreferrer">
              Privacy policy
            </a>
          </>
        ) : null}
      </p>
    </form>
  );
}

/** Pre-event homework under the countdown's button. */
function Homework({ funnel, branding }: { funnel: FunnelRow; branding: Branding }) {
  const items = linkItems(funnel.homeworkItems);
  if (!funnel.homeworkEnabled || (!items.length && !funnel.homeworkTitle.trim() && !funnel.homeworkSubtitle.trim())) return null;
  return (
    <div className="pcf-homework">
      <div className="pcf-hw-badge">📝 Before we start</div>
      {funnel.homeworkTitle.trim() ? <h2 className="pcf-hw-h [overflow-wrap:anywhere]">{funnel.homeworkTitle}</h2> : null}
      {funnel.homeworkSubtitle.trim() ? <p className="pcf-hw-sub [overflow-wrap:anywhere]">{funnel.homeworkSubtitle}</p> : null}
      <LinkList items={items} branding={branding} dark />
    </div>
  );
}

/** Under the waitlist countdown: Add to calendar, swapped for "join early" N minutes before the session. */
function WaitlistAction({ loaded, ctx, startAt }: { loaded: LoadedFunnel; ctx: PageContext; startAt: Date }) {
  const { funnel } = loaded;
  const calendar = <SessionCalendar loaded={loaded} day={null} base={ctx.base} origin={ctx.origin} tone="dark" />;
  if (funnel.mode !== "live" || !funnel.earlyJoinEnabled) return calendar;
  const session = upcomingSessions(loaded)[0];
  const goLive = session?.liveStartAt ?? startAt;
  const url = [funnel.earlyJoinUrl, session?.liveUrl, funnel.livestreamUrl].find((value) => value && /^https?:\/\//i.test(value));
  if (!url) return calendar;
  return (
    <EarlyJoin revealAt={goLive.getTime() - funnel.earlyJoinMinutes * 60_000} serverNow={loaded.now.getTime()} url={url} text={funnel.earlyJoinText}>
      {calendar}
    </EarlyJoin>
  );
}

export function WaitlistView({
  loaded,
  ctx,
  days,
  startAt,
  optin,
  hosts,
}: {
  loaded: LoadedFunnel;
  ctx: PageContext;
  days: (DayRow | AgendaPlaceholder)[];
  startAt: Date;
  optin: ReactNode;
  hosts?: ReactNode;
}) {
  const { funnel, timeZone, preview, now } = loaded;
  const { branding } = ctx.theme;
  const bg = colorOr(funnel.waitlistBg);
  const color = colorOr(funnel.waitlistText) ?? (bg ? undefined : branding.headerText);
  const image = funnel.waitlistBgImageUrl && /^https:\/\/[^\s"'()<>\\]+$/i.test(funnel.waitlistBgImageUrl) ? funnel.waitlistBgImageUrl : null;
  const style = {
    ...(bg ? { background: bg } : {}),
    ...(color ? { color } : {}),
    ...(image ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
  };
  const asOf = preview && loaded.carry.includes("as_of=");
  const start = effectiveStart(rulesOf(loaded), viewerFacts(ctx.viewer), now);
  return (
    <>
      <section className={`pcf-landing ${bg || image ? "" : "pcf-header"}`} style={style}>
        <div className="pcf-wrap">
          {branding.logoSrc ? <img src={branding.logoSrc} alt={branding.brandName} className="pcf-landing-logo" style={{ maxHeight: Math.round(branding.logoHeight * 1.2) }} /> : null}
          <h1 className="pcf-landing-h">{funnel.waitlistHeadline || funnel.name}</h1>
          {funnel.waitlistSubheadline ? <p className="pcf-landing-sub [overflow-wrap:anywhere]">{funnel.waitlistSubheadline}</p> : null}
          <Countdown
            target={startAt.getTime()}
            serverNow={now.getTime()}
            reloadTo={asOf ? null : `${ctx.base || "/"}${loaded.carry}`}
            labelColor={color ?? "currentColor"}
            boxColor={colorOr(funnel.countdownBoxBg, "#ffffff")!}
            digitColor={colorOr(funnel.countdownDigit, "#111827")!}
          />
          <p className="pcf-landing-when">{formatZoned(startAt, timeZone)}</p>
          <div className="pcf-landing-action">
            <WaitlistAction loaded={loaded} ctx={ctx} startAt={startAt} />
          </div>
          <Homework funnel={funnel} branding={branding} />
          {optin ? <div className="mt-8">{optin}</div> : null}
        </div>
      </section>
      <Agenda
        funnel={funnel}
        days={days}
        timeZone={timeZone}
        start={start}
        bg={colorOr(funnel.agendaBg)}
        text={colorOr(funnel.agendaText)}
        thumbFor={(day) => dayThumb(day, ctx.base, ctx.states[loaded.days.findIndex((item) => item.id === day.id)]?.kind === "video")}
        calendarFor={(day) => <SessionCalendar loaded={loaded} day={day} base={ctx.base} origin={ctx.origin} compact />}
      />
      {hosts}
    </>
  );
}

export function ClosedView({ funnel, branding }: { funnel: FunnelRow; branding: Branding }) {
  return (
    <section className="pcf-wrap pcf-message">
      <h1 className="pcf-title">{funnel.closeHeadline}</h1>
      <Rich html={funnel.closeMessageHtml} className="pcf-text mx-auto max-w-2xl" />
      {funnel.closeButtonText && funnel.closeButtonUrl ? (
        <div className="mt-8">
          <a href={funnel.closeButtonUrl} className="pcf-btn text-base shadow-sm" data-track="close_button" data-track-target={funnel.closeButtonText} style={{ background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor }}>
            {funnel.closeButtonText}
          </a>
        </div>
      ) : null}
    </section>
  );
}

/** The dark box in the video's place: locked, coming soon, replay pending, countdowns. */
function Placeholder({ title, message, lock, children, look }: { title: string; message: string; lock?: boolean; children?: ReactNode; look?: { bg: string | null; text: string | null; minimal: boolean } }) {
  const minimal = Boolean(look?.minimal);
  return (
    <div className={`pcf-ph-box${minimal ? " is-minimal" : ""}`} style={look && (look.bg || look.text) ? { ...(look.bg ? { background: look.bg } : {}), ...(look.text ? { color: look.text } : {}) } : undefined}>
      {lock && !minimal ? (
        <div className="pcf-ph-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor">
            <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
          </svg>
        </div>
      ) : null}
      <h2 className="pcf-ph-title [overflow-wrap:anywhere]">{title}</h2>
      {message && !minimal ? <p className="pcf-ph-msg [overflow-wrap:anywhere]">{message}</p> : null}
      {children}
    </div>
  );
}

/**
 * One module page: the state engine's answer for this module, rendered the way
 * the old app did. `day` comes from the safe days (no video id unless open).
 */
export function DayView({
  loaded,
  ctx,
  day,
  presentedKey,
  nav,
  sms,
  offer,
}: {
  loaded: LoadedFunnel;
  ctx: PageContext;
  day: DayRow;
  presentedKey: string | null;
  nav: ReactNode;
  sms?: ReactNode;
  /** The funnel's offer section (blocks), shown under the module with anchor #offer. */
  offer?: ReactNode;
}) {
  const { funnel, timeZone, preview, now, carry } = loaded;
  const { base, states, safeDays: days } = ctx;
  const { branding } = ctx.theme;
  const syncUrl = preview ? null : `${base}/sync`;
  const asOf = preview && carry.includes("as_of=");
  const index = days.findIndex((item) => item.id === day.id);
  const state = states[index]!;
  const next = days[index + 1];
  const nextOpen = next ? isOpen(states[index + 1]!) : false;
  const label = dayLabel(day);
  const title = day.title || label;
  const reloadTo = `${base}/day-${day.position}${carry}`;
  const liveFunnel = funnel.mode === "live";
  const liveDay = liveFunnel && day.isLive;
  const text = isTextModule(day, funnel.mode);
  const look = funnel.countdownStyle === "flip" ? ("flip" as const) : ("boxes" as const);
  const boxLook = { bg: isHexColor(funnel.lockedBoxBg ?? "") ? funnel.lockedBoxBg : null, text: isHexColor(funnel.lockedBoxText ?? "") ? funnel.lockedBoxText : null, minimal: funnel.lockedBoxMinimal };
  const sidebar = funnel.navLayout === "sidebar";
  // A locked module offers the closest earlier module that has its video.
  let previous: DayRow | undefined;
  if (state.kind === "locked") for (let at = index - 1; at >= 0; at -= 1) if (states[at]!.kind === "video") { previous = days[at]; break; }

  let box: ReactNode = null;
  if (state.kind === "video") {
    if (text) {
      box = (
        <>
          <Rich html={day.bodyHtml} className="pcf-content pcf-text" />
          {funnel.progression === "watch_percent" && syncUrl && (ctx.viewer?.watched[day.id] ?? 0) < 100 ? <TextProgress syncUrl={syncUrl} dayId={day.id} /> : null}
        </>
      );
    } else {
      const video = dayVideo(day)!;
      box = (
        <DayVideo
          provider={video.provider}
          videoId={video.id}
          dayId={day.id}
          syncUrl={syncUrl}
          unlockAt={funnel.progression === "watch_percent" ? funnel.watchPercent : null}
          alreadyWatched={ctx.viewer?.watched[day.id] ?? 0}
          durationHint={day.videoDuration}
        />
      );
    }
  } else if (state.kind === "live") {
    box = <LiveRedirect url={state.url} headline={funnel.liveHeadline} sub={funnel.liveSubheadline} syncUrl={syncUrl} dayId={day.id} />;
  } else if (state.kind === "replay_pending") {
    box = <Placeholder title={funnel.replayPendingTitle} message={funnel.replayPendingMessage} />;
  } else if (state.kind === "coming_soon") {
    box = <Placeholder title={funnel.comingSoonTitle} message={funnel.comingSoonMessage} />;
  } else if (state.kind === "locked") {
    const template =
      day.lockedMessage?.trim() ||
      (state.reason === "passed"
        ? funnel.lockedPassedMsg
        : state.reason === "expired"
        ? funnel.lockedExpiredMsg
        : state.reason === "watch"
        ? funnel.lockedWatchMsg
        : state.reason === "key"
          ? funnel.lockedKeyMsg
          : state.reason === "live_upcoming" || (state.reason === "not_started" && liveDay)
            ? funnel.lockedLiveMsg
            : funnel.lockedScheduledMsg);
    const prev = state.prevPosition ? days.find((item) => item.position === state.prevPosition) : undefined;
    // Passed: a later module is open now, and this page points to it.
    const newest = state.nextPosition ? days.find((item) => item.position === state.nextPosition) : undefined;
    const message = fillLockMessage(template, { day: label, prevDay: prev ? dayLabel(prev) : undefined, nextDay: newest ? dayLabel(newest) : undefined, percent: funnel.watchPercent, unlockDate: state.unlockAt ? formatZoned(state.unlockAt, timeZone) : undefined });
    const rules = rulesOf(loaded);
    const dayRule = dayRulesOf(loaded)[loaded.days.findIndex((item) => item.id === day.id)]!;
    // An EARLIER session not over yet: this one waits its turn (no countdown); if that session is today, point to it.
    const pending = liveDay ? earlierPendingSession(rules, dayRulesOf(loaded), dayRule, now) : undefined;
    const pendingDay = pending ? days.find((item) => item.id === pending.id) : undefined;
    const pendingLive = Boolean(pending && isLiveNow(rules, pending, now));
    const pendingToday = Boolean(pending && (pendingLive || dayKey(pending.liveStartAt!, timeZone) === dayKey(now, timeZone)));
    const calendar = <SessionCalendar loaded={loaded} day={day} base={base} origin={ctx.origin} tone="dark" />;
    const countdown = (target: Date) => (
      <Countdown
        variant="box"
        look={look}
        target={target.getTime()}
        serverNow={now.getTime()}
        reloadTo={asOf || funnel.countdownZero === "stay" ? null : reloadTo}
        labelColor={boxLook.text ?? "#ffffff"}
        boxColor={isHexColor(funnel.countdownBoxBg) ? funnel.countdownBoxBg : "#ffffff"}
        digitColor={isHexColor(funnel.countdownDigit) ? funnel.countdownDigit : "#111827"}
      />
    );
    const sessionDay = state.unlockAt ? dayKey(state.unlockAt, timeZone) === dayKey(now, timeZone) : false;
    const showLiveCountdown = liveDay && !pending && funnel.liveCountdown && state.reason === "live_upcoming" && Boolean(state.unlockAt) && state.unlockAt! > now && sessionDay;
    const mode = funnel.unlockCountdownMode;
    const showUnlockCountdown =
      !showLiveCountdown && !liveDay && mode !== "off" && Boolean(state.unlockAt) && (state.reason === "scheduled" || state.reason === "not_started") && state.unlockAt! > now && (mode === "always" || sessionDay);
    if (showUnlockCountdown) {
      box = (
        <Placeholder title={funnel.unlockCountdownTitle.replaceAll("{day}", label)} message={message} look={boxLook}>
          {countdown(state.unlockAt!)}
        </Placeholder>
      );
    } else if (showLiveCountdown) {
      const early = [funnel.earlyJoinUrl, day.liveUrl, funnel.livestreamUrl].find((value) => value && /^https?:\/\//i.test(value));
      box = (
        <Placeholder title={funnel.liveCountdownTitle} message={message}>
          {countdown(state.unlockAt!)}
          <div className="flex justify-center">
            {funnel.earlyJoinEnabled && early ? (
              <EarlyJoin revealAt={state.unlockAt!.getTime() - funnel.earlyJoinMinutes * 60_000} serverNow={now.getTime()} url={early} text={funnel.earlyJoinText}>
                {calendar}
              </EarlyJoin>
            ) : (
              calendar
            )}
          </div>
        </Placeholder>
      );
    } else {
      const pointer =
        funnel.todayTrainingEnabled && pendingDay && pendingToday ? (
          <div className="mb-4 space-y-3">
            <p className="mx-auto max-w-lg font-bold [overflow-wrap:anywhere]">
              {fillLockMessage(pendingLive ? funnel.todayTrainingLiveMsg : funnel.todayTrainingMsg, { day: pendingDay.title ? `${dayLabel(pendingDay)}: ${pendingDay.title}` : dayLabel(pendingDay), percent: funnel.watchPercent }).replaceAll(
                "{time}",
                pendingDay.liveStartAt ? formatTimeOnly(pendingDay.liveStartAt, timeZone) : "",
              )}
            </p>
            <a href={`${base}/day-${pendingDay.position}${carry}`} className="pcf-btn text-base" data-track="today_training" data-track-target={dayLabel(pendingDay)} style={pendingLive ? { background: "#d92d20", color: "#ffffff", borderColor: "#d92d20" } : { background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor }}>
              {pendingLive ? <span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white" aria-hidden="true" /> : null}
              {funnel.todayTrainingText}
            </a>
          </div>
        ) : null;
      const toNewest = newest ? (
        <div className="mb-4">
          <a href={`${base}/day-${newest.position}${carry}`} className="pcf-btn text-base" data-track="next" data-track-target={dayLabel(newest)} style={{ background: branding.accentColor, color: branding.accentText, borderColor: branding.accentColor }}>
            {`Watch ${newest.title ? `${dayLabel(newest)}: ${newest.title}` : dayLabel(newest)} »`}
          </a>
        </div>
      ) : null;
      // Expired episode: point to the offer when the page has one.
      const toOffer =
        state.reason === "expired" && offer ? (
          <div className="mb-4">
            <a href="#offer" className="pcf-btn text-base" data-track="offer" data-track-target={`expired:${label}`}>
              Get full access »
            </a>
          </div>
        ) : null;
      box = (
        <Placeholder title={state.reason === "expired" ? "Access expired" : funnel.lockedTitle} message={message} lock look={{ ...boxLook, minimal: false }}>
          {pointer}
          {toNewest}
          {toOffer}
          <div className="flex justify-center">{calendar}</div>
        </Placeholder>
      );
    }
  }

  const resources = linkItems(day.resources);
  const showCta = state.kind === "video" && day.ctaReveal !== "none" && day.ctaText.trim() && day.ctaUrl.trim();
  const livendar = state.kind === "closed" ? "" : day.livendarMode === "off" ? "" : day.livendarMode === "custom" ? day.livendarHtml : funnel.livendarHtml;
  const sameDay = loaded.days.find((item) => item.id === day.id);
  return (
    <>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={day.id} unlockKey={presentedKey} refreshOnUnlock={Boolean(presentedKey)} /> : null}
      <ClickTracker syncUrl={syncUrl} dayId={day.id} page="day" />
      {sidebar ? null : nav}
      <section className={`pcf-wrap pcf-day${sidebar ? " is-split" : ""}`}>
        <div className={sidebar ? "pcf-split" : undefined}>
        <div className={sidebar ? "pcf-split-main" : undefined}>
        <h1 className="pcf-title">{title}</h1>
        {text && state.kind === "video" ? (
          box
        ) : (
          <div className={`pcf-frame${state.kind === "video" ? "" : " is-ph"}`}>
            <div className="pcf-frame-inner">{box}</div>
          </div>
        )}
        {/* Refresh the moment this module unlocks or goes live, countdown or not. */}
        {state.kind === "locked" && state.unlockAt && state.unlockAt > now && !asOf ? <UnlockRefresh at={state.unlockAt.getTime()} serverNow={now.getTime()} reloadTo={reloadTo} /> : null}
        {/* Live session modules keep the video box; their text sits underneath in every state. */}
        {liveDay && sameDay && hasBody(sameDay.bodyHtml) ? <Rich html={sameDay.bodyHtml} className="pcf-content pcf-text pcf-below" /> : null}
        {/* Video modules: notes under the video once it is open (PubCommand addition). */}
        {!text && !liveDay && state.kind === "video" && hasBody(day.bodyHtml) ? <Rich html={day.bodyHtml} className="pcf-content pcf-text pcf-below" /> : null}
        {livendar.trim() ? (
          <section className="mx-auto mb-1.5 mt-6 text-center">
            {funnel.livendarTitle.trim() ? <h3 className="mb-3 text-[17px] font-extrabold">{funnel.livendarTitle}</h3> : null}
            <div className="[overflow-wrap:anywhere]" data-track="calendar" data-track-day={day.id} dangerouslySetInnerHTML={{ __html: sanitizeEmbed(livendar) }} />
          </section>
        ) : null}
        {sms && state.kind !== "closed" ? <div className="mt-6">{sms}</div> : null}
        {previous ? (
          <div className="pcf-row is-prev">
            <a href={`${base}/day-${previous.position}${carry}`} className="pcf-next" data-track="prev" data-track-target={dayLabel(previous)}>
              « {funnel.prevButtonText}
            </a>
          </div>
        ) : null}
        {next && state.kind === "video" && nextOpen ? (
          <div className="pcf-row">
            <a href={`${base}/day-${next.position}${carry}`} className="pcf-next" data-track="next" data-track-target={dayLabel(next)}>
              {funnel.nextButtonText} »
            </a>
          </div>
        ) : null}
        {day.showAgenda ? (
          <Agenda
            funnel={funnel}
            days={day.agendaScope === "module" ? [day] : ctx.agenda}
            timeZone={timeZone}
            current={day.agendaScope === "module" ? undefined : day.id}
            boxed
            start={effectiveStart(rulesOf(loaded), viewerFacts(ctx.viewer), now)}
            bg={colorOr(funnel.agendaBg, "#ffffff")}
            text={colorOr(funnel.agendaText, "#1f2937")}
            linkFor={day.agendaScope === "module" ? undefined : (item) => `${base}/day-${item.position}${carry}`}
            thumbFor={(item) => dayThumb(item, base, states[days.findIndex((row) => row.id === item.id)]?.kind === "video")}
            calendarFor={(item) => <SessionCalendar loaded={loaded} day={item} base={base} origin={ctx.origin} compact />}
          />
        ) : null}
        {showCta ? (
          <CtaButton
            dayId={day.id}
            reveal={day.ctaReveal === "always" ? "always" : day.ctaReveal === "datetime" ? "datetime" : "video_time"}
            seconds={day.ctaSeconds}
            at={day.ctaAt ? day.ctaAt.getTime() : null}
            serverNow={now.getTime()}
            text={day.ctaText}
            subtext={day.ctaSubtext}
            url={day.ctaUrl}
            newTab={day.ctaNewTab}
            bg={colorOr(day.ctaBg, branding.accentColor)!}
            color={colorOr(day.ctaTextColor, colorOr(day.ctaBg) ? "#ffffff" : branding.accentText)!}
            borderColor={colorOr(day.ctaBg, branding.accentColor)!}
          />
        ) : null}
        {state.kind === "video" && resources.length ? (
          <section className="pcf-resources">
            {day.resourcesHeading.trim() ? <h2 className="pcf-res-h">{day.resourcesHeading}</h2> : null}
            <LinkList items={resources} branding={branding} dayId={day.id} />
          </section>
        ) : null}
        </div>
        {sidebar ? <EpisodeList funnel={funnel} days={days} states={states} base={base} carry={carry} currentDayId={day.id} now={now} /> : null}
        </div>
      </section>
      {offer && day.showOffer && state.kind !== "closed" ? (
        <section id="offer" className="pcf-offer" aria-label="Offer">
          {offer}
        </section>
      ) : null}
    </>
  );
}

export function FormOptin({ src, headline }: { src: string; headline: string }) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-xl bg-white p-2 text-left text-[#111827]">
      {headline ? <p className="px-3 pt-3 text-center text-base font-semibold">{headline}</p> : null}
      <FormEmbed src={src} title={headline || "Sign up"} />
    </div>
  );
}

/** The close page with its view and click tracking (button clicks show as "close_button"). */
export function ClosedPage({ loaded, ctx }: { loaded: LoadedFunnel; ctx: PageContext }) {
  const syncUrl = loaded.preview ? null : `${ctx.base}/sync`;
  return (
    <>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={null} page="close" /> : null}
      <ClickTracker syncUrl={syncUrl} dayId={null} page="close" />
      <ClosedView funnel={loaded.funnel} branding={ctx.theme.branding} />
    </>
  );
}

/** What the preview bar says: draft, unsaved changes, first-time visitor. */
export function previewLabel(loaded: LoadedFunnel, fresh?: string): string {
  return [loaded.funnel.status === "published" ? "" : "draft (only your team can see it)", loaded.draftShown ? "unsaved changes" : "", fresh === "1" ? "as a first-time visitor" : ""].filter(Boolean).join(", ");
}
