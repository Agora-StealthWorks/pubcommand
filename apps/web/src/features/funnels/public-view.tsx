import type { ReactNode } from "react";
import { fillLockMessage, scheduledUnlock, type DayState } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { dayLabel, dayThumb, dayVideo, emailConsent, type Branding, type DayRow, type FunnelRow } from "./data";
import { Countdown, DayVideo, FormEmbed, LiveRedirect, TrackedLink, ViewerSync } from "./public-client";
import { sanitizeRich } from "./sanitize";

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
              <img src={branding.logoSrc} alt={branding.brandName} style={{ maxHeight: branding.logoHeight, maxWidth: "100%", width: "auto" }} />
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

/** When a day opens, if the funnel knows it (agenda and locked messages). */
export function dayWhen(funnel: FunnelRow, day: DayRow): Date | null {
  if (funnel.mode === "live" && day.isLive && day.liveStartAt) return day.liveStartAt;
  if (funnel.progression === "scheduled") return scheduledUnlock(day, funnel.timing === "fixed" ? funnel.startAt : null);
  if (day.position === 1 && funnel.timing === "fixed") return funnel.startAt;
  return null;
}

export type AgendaPlaceholder = { id: string; label: string; title: string; agendaWhen: string; agendaDesc: string; faded: boolean };

/** The agenda: modules in order, with "coming soon" placeholders placed among them. */
export function Agenda({ funnel, days, timeZone, current, title }: { funnel: FunnelRow; days: (DayRow | AgendaPlaceholder)[]; timeZone: string; current?: string; title?: string }) {
  if (!days.length) return null;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h2 className="mb-5 text-center text-2xl font-bold tracking-tight">{title ?? funnel.agendaTitle}</h2>
      <ol className="space-y-3">
        {days.map((entry) => {
          if (!("position" in entry)) {
            return (
              <li key={entry.id} className="pcf-content shadow-sm" style={entry.faded ? { opacity: 0.6 } : undefined}>
                <p className="text-xs font-bold uppercase tracking-wider opacity-70">
                  {entry.label || "Coming soon"}
                  {entry.agendaWhen ? ` · ${entry.agendaWhen}` : ""}
                </p>
                <p className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{entry.title || entry.label || "Coming soon"}</p>
                {entry.agendaDesc ? <p className="mt-1 text-sm [overflow-wrap:anywhere]">{entry.agendaDesc}</p> : null}
              </li>
            );
          }
          const day = entry;
          const when = dayWhen(funnel, day);
          return (
            <li key={day.id} className={`pcf-content shadow-sm ${current === day.id ? "ring-2 ring-current" : ""}`}>
              <p className="text-xs font-bold uppercase tracking-wider opacity-70">
                {dayLabel(day)}
                {funnel.mode === "live" && day.isLive ? " · Live" : ""}
                {when ? ` · ${formatZoned(when, timeZone)}` : ""}
              </p>
              <p className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{day.title || dayLabel(day)}</p>
              {day.topics.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {day.topics.map((topic, index) => (
                    <li key={index} className="[overflow-wrap:anywhere]">
                      {topic}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
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

export function WaitlistView({
  funnel,
  days,
  branding,
  timeZone,
  startAt,
  optin,
  hosts,
  calendar,
}: {
  funnel: FunnelRow;
  days: (DayRow | AgendaPlaceholder)[];
  branding: Branding;
  timeZone: string;
  startAt: Date;
  optin: ReactNode;
  hosts?: ReactNode;
  calendar?: ReactNode;
}) {
  return (
    <>
      <section className="pcf-header px-4 py-12 text-center sm:py-16">
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{funnel.waitlistHeadline || funnel.name}</h1>
          <Countdown target={startAt.getTime()} labelColor={branding.headerText} boxColor="#ffffff" digitColor="#111827" />
          <p className="text-sm font-semibold opacity-90">{formatZoned(startAt, timeZone)}</p>
          {funnel.waitlistSubheadline ? <p className="mx-auto max-w-xl text-base opacity-90 [overflow-wrap:anywhere]">{funnel.waitlistSubheadline}</p> : null}
          {calendar}
          {optin}
        </div>
      </section>
      <Agenda funnel={funnel} days={days} timeZone={timeZone} />
      {hosts}
    </>
  );
}

export function ClosedView({ funnel, branding }: { funnel: FunnelRow; branding: Branding }) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-4xl">{funnel.closeHeadline}</h1>
      <Rich html={funnel.closeMessageHtml} className="mt-4 text-base" />
      {funnel.closeButtonText && funnel.closeButtonUrl ? (
        <div className="mt-8">
          <Button href={funnel.closeButtonUrl} branding={branding}>
            {funnel.closeButtonText}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function DayNav({ days, states, base, carry, currentId }: { days: DayRow[]; states: DayState[]; base: string; carry: string; currentId: string }) {
  return (
    <nav aria-label="Days" className="mx-auto max-w-5xl px-4 pt-6">
      <ol className="flex gap-3 overflow-x-auto pb-2">
        {days.map((day, index) => {
          const state = states[index]!;
          const open = state.kind !== "locked" && state.kind !== "closed";
          const thumb = dayThumb(day, base, state.kind === "video");
          const current = day.id === currentId;
          return (
            <li key={day.id} className="w-32 shrink-0 sm:w-40">
              <a href={`${base}/day-${day.position}${carry}`} aria-current={current ? "page" : undefined} className={`block rounded-lg ${current ? "ring-2 ring-offset-2" : ""} ${open && !current ? "opacity-80 hover:opacity-100" : ""} ${!open ? "opacity-50" : ""}`}>
                <span className="relative block overflow-hidden rounded-lg bg-black/80" style={{ aspectRatio: "16 / 9" }}>
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-sm font-bold text-white">{open ? dayLabel(day) : ""}</span>
                  )}
                  {!open ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xl text-white" aria-label="Locked">
                      🔒
                    </span>
                  ) : null}
                  {state.kind === "live" ? <span className="absolute left-1.5 top-1.5 rounded bg-[#d92d20] px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span> : null}
                </span>
                <span className="mt-1.5 block truncate text-xs font-semibold">{dayLabel(day)}</span>
                {day.title ? <span className="block truncate text-xs opacity-80">{day.title}</span> : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type Resource = { label: string; url: string };

function resourcesOf(value: unknown): Resource[] {
  return Array.isArray(value) ? value.filter((item): item is Resource => Boolean(item && typeof item === "object" && typeof (item as Resource).url === "string" && /^https?:\/\//.test((item as Resource).url))) : [];
}

export function DayView({
  funnel,
  days,
  states,
  day,
  branding,
  timeZone,
  base,
  carry,
  syncUrl,
  presentedKey,
  now,
  preview,
  nav,
  calendar,
  sms,
}: {
  funnel: FunnelRow;
  days: DayRow[];
  states: DayState[];
  day: DayRow;
  /** The navigation strip (rendered by the page, so pages and links sit among the modules). */
  nav?: ReactNode;
  /** Add-to-calendar for an upcoming live session. */
  calendar?: ReactNode;
  /** An SMS opt-in form under the video (open days only). */
  sms?: ReactNode;
  branding: Branding;
  timeZone: string;
  base: string;
  carry: string;
  syncUrl: string | null;
  presentedKey: string | null;
  now: Date;
  preview: boolean;
}) {
  const index = days.findIndex((item) => item.id === day.id);
  const state = states[index]!;
  const next = days[index + 1];
  const nextState = states[index + 1];
  const label = dayLabel(day);
  const title = day.title || label;
  const ctaShown = day.ctaText.trim() && day.ctaUrl.trim() && (day.ctaReveal === "always" || (day.ctaReveal === "datetime" && day.ctaAt && now >= day.ctaAt));
  const ctaTimed = day.ctaText.trim() && day.ctaUrl.trim() && day.ctaReveal === "video_time" ? day.ctaSeconds : null;
  const cta = (
    <div className="text-center">
      <Button href={day.ctaUrl} branding={branding} syncUrl={syncUrl} dayId={day.id}>
        {day.ctaText}
      </Button>
      {day.ctaSubtext ? <p className="mt-2 text-sm opacity-80">{day.ctaSubtext}</p> : null}
    </div>
  );
  const resources = resourcesOf(day.resources);
  let box: ReactNode;
  if (state.kind === "video") {
    const video = dayVideo(day)!;
    box = (
      <>
        <DayVideo provider={video.provider} videoId={video.id} dayId={day.id} syncUrl={syncUrl} ctaSeconds={ctaTimed} cta={cta} />
        {ctaShown ? <div className="mt-5">{cta}</div> : null}
      </>
    );
  } else if (state.kind === "live") {
    box = (
      <div className="rounded-xl bg-[#111827] px-4 py-12 text-center text-white">
        <p className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#d92d20] px-3 py-1 text-xs font-bold">● LIVE NOW</p>
        <h2 className="text-3xl font-extrabold">{funnel.liveHeadline}</h2>
        {funnel.liveSubheadline ? <p className="mt-2 opacity-90">{funnel.liveSubheadline}</p> : null}
        {state.url ? (
          <div className="mt-6">
            <Button href={state.url} branding={branding} syncUrl={syncUrl} dayId={day.id}>
              Join the livestream
            </Button>
            {!preview ? <LiveRedirect url={state.url} /> : null}
          </div>
        ) : null}
      </div>
    );
  } else if (state.kind === "locked") {
    const template = state.reason === "watch" ? funnel.lockedWatchMsg : state.reason === "key" ? funnel.lockedKeyMsg : state.reason === "live_upcoming" ? funnel.lockedLiveMsg : funnel.lockedScheduledMsg;
    const previous = state.prevPosition ? days.find((item) => item.position === state.prevPosition) : undefined;
    const message = fillLockMessage(template, {
      day: label,
      prevDay: previous ? dayLabel(previous) : undefined,
      percent: funnel.watchPercent,
      unlockDate: state.unlockAt ? formatZoned(state.unlockAt, timeZone) : undefined,
    });
    box = (
      <div className="rounded-xl bg-[#111827] px-4 py-12 text-center text-white">
        <p className="text-4xl" aria-hidden="true">
          🔒
        </p>
        <h2 className="mt-3 text-2xl font-extrabold">{funnel.lockedTitle}</h2>
        <p className="mx-auto mt-2 max-w-lg opacity-90">{message}</p>
        {state.unlockAt ? (
          <div className="mx-auto mt-6 max-w-md">
            <Countdown target={state.unlockAt.getTime()} labelColor="#ffffff" boxColor="#ffffff" digitColor="#111827" reloadAtZero={!preview} />
          </div>
        ) : null}
        {calendar ? <div className="mt-6">{calendar}</div> : null}
      </div>
    );
  } else if (state.kind === "replay_pending" || state.kind === "coming_soon") {
    const [heading, message] = state.kind === "replay_pending" ? [funnel.replayPendingTitle, funnel.replayPendingMessage] : [funnel.comingSoonTitle, funnel.comingSoonMessage];
    box = (
      <div className="rounded-xl bg-[#111827] px-4 py-12 text-center text-white">
        <h2 className="text-2xl font-extrabold">{heading}</h2>
        <p className="mx-auto mt-2 max-w-lg opacity-90">{message}</p>
      </div>
    );
  }
  const open = state.kind === "video" || state.kind === "replay_pending";
  return (
    <>
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={day.id} unlockKey={presentedKey} refreshOnUnlock={Boolean(presentedKey)} /> : null}
      {nav === undefined ? <DayNav days={days} states={states} base={base} carry={carry} currentId={day.id} /> : nav}
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</p>
        <h1 className="mb-4 mt-1 text-2xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">{title}</h1>
        {box}
        {open && sms ? <div className="mt-6">{sms}</div> : null}
        {open ? (
          <div className="mt-6 space-y-6">
            <Rich html={day.bodyHtml} className="pcf-content text-base" />
            {resources.length ? (
              <section className="pcf-content">
                <h2 className="mb-3 text-lg font-bold">{day.resourcesHeading}</h2>
                <ul className="flex flex-wrap gap-2">
                  {resources.map((resource, position) => (
                    <li key={position} className="max-w-full">
                      <a href={resource.url} target="_blank" rel="noopener noreferrer" className="pcf-btn-quiet max-w-full text-sm [overflow-wrap:anywhere]" style={{ borderColor: branding.accentColor, color: branding.accentColor }}>
                        {resource.label || resource.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
        {next && nextState && nextState.kind !== "locked" && nextState.kind !== "closed" ? (
          <div className="mt-8 text-center">
            <a href={`${base}/day-${next.position}${carry}`} className="pcf-btn-quiet text-sm" style={{ borderColor: branding.accentColor, color: branding.accentColor }}>
              {funnel.nextButtonText} →
            </a>
          </div>
        ) : null}
      </main>
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
