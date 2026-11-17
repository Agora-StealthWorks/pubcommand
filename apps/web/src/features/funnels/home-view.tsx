import type { ReactNode } from "react";
import { blockBandStyle, WIDTH_PX, type Block } from "../../../../../modules/funnels/blocks";
import { eventBoxEvent } from "../../../../../modules/funnels/calendar";
import { agendaSequence } from "../../../../../modules/funnels/nav";
import { effectiveEnd, effectiveStart, isOpen, type DayState } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { assetSrc, dayLabel, dayThumb, funnelRules, type DayRow, type FunnelRow, type HostRow, type NavItemRow } from "./data";
import { orgPublicUrl } from "./guard";
import type { LoadedFunnel } from "./public";
import { viewerFacts } from "./public";
import { Countdown } from "./public-client";
import { AddToCalendar } from "./public-shell";
import { Agenda, dayWhen, EmailOptin, FormOptin, Rich, type AgendaPlaceholder } from "./public-view";
import { HtmlFrame } from "./site-client";
import { pageHref, type FunnelTheme } from "./site-data";
import type { ViewerCookie } from "../../../../../modules/funnels/viewer";
import { sanitizeRich } from "./sanitize";
import { SmsSlot, smsFormFor } from "./sms-slot";

/** Agenda entries: the modules with placeholders marked "list in the agenda" placed among them. */
export function agendaEntries(days: DayRow[], navItems: NavItemRow[]): (DayRow | AgendaPlaceholder)[] {
  return agendaSequence(days, navItems).map((entry) =>
    entry.kind === "day" ? entry.day : { id: entry.item.id, label: entry.item.label, title: entry.item.title, agendaWhen: entry.item.agendaWhen, agendaDesc: entry.item.agendaDesc, faded: entry.item.faded },
  );
}

export function hostPhoto(funnel: Pick<FunnelRow, "slug">, host: HostRow): string | null {
  if (host.photoAssetId) return assetSrc(funnel, host.photoAssetId, host.updatedAt);
  return host.photoUrl && /^https:\/\//i.test(host.photoUrl) ? host.photoUrl : null;
}

/** Host cards: photo, name, title, bio. Used by the waitlist and the hosts block. */
export function HostCards({ funnel, hosts, layout = "grid" }: { funnel: FunnelRow; hosts: HostRow[]; layout?: "grid" | "stacked" }) {
  if (!hosts.length) return null;
  return (
    <div className={layout === "grid" ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>
      {hosts.map((host) => {
        const photo = hostPhoto(funnel, host);
        return (
          <article key={host.id} className={`pcf-content flex gap-4 text-left ${layout === "grid" ? "flex-col items-center text-center sm:items-start sm:text-left" : "flex-col sm:flex-row"}`}>
            {photo ? <img src={photo} alt={host.name} className="h-28 w-28 shrink-0 rounded-full object-cover" loading="lazy" /> : null}
            <div className="min-w-0">
              <h3 className="text-lg font-bold [overflow-wrap:anywhere]">{host.name}</h3>
              {host.title ? <p className="text-sm font-semibold opacity-75 [overflow-wrap:anywhere]">{host.title}</p> : null}
              <Rich html={host.bioHtml} className="mt-2 text-sm" />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function HostsSection({ funnel, hosts, title }: { funnel: FunnelRow; hosts: HostRow[]; title: string }) {
  if (!hosts.length) return null;
  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-12">
      <h2 className="mb-5 text-center text-2xl font-bold tracking-tight">{title}</h2>
      <HostCards funnel={funnel} hosts={hosts} />
    </section>
  );
}

type HomeContext = {
  loaded: LoadedFunnel;
  theme: FunnelTheme;
  viewer: ViewerCookie | null;
  states: DayState[];
  /** Days safe to render (locked ones carry no video id). */
  days: DayRow[];
  base: string;
  /** Absolute origin for invite links. */
  origin: string;
  query: { joined?: string; error?: string; block?: string; sms_done?: string; sms_form?: string; sms_error?: string };
  host: string;
};

function resolveHref(ctx: HomeContext, target: string): { href: string; external: boolean } | null {
  const module = /^module:(\d{1,3})$/.exec(target);
  if (module) return ctx.days.some((day) => day.position === Number(module[1])) ? { href: `${ctx.base}/day-${module[1]}${ctx.loaded.carry}`, external: false } : null;
  const page = /^page:([a-z0-9-]+)$/.exec(target);
  if (page) return ctx.loaded.navItems.some((item) => item.kind === "page" && item.slug === page[1]) ? { href: pageHref(ctx.loaded.funnel, ctx.base, page[1]!, ctx.loaded.carry), external: false } : null;
  return /^https?:\/\//i.test(target) ? { href: target, external: true } : null;
}

function Eyebrow({ text }: { text: string }) {
  return text ? <p className="pcf-accent mb-2 text-xs font-bold uppercase tracking-[0.18em] [overflow-wrap:anywhere]">{text}</p> : null;
}

function Heading({ text }: { text: string }) {
  return text ? <h2 className="mb-4 text-2xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">{text}</h2> : null;
}

function AgendaCards({ ctx, entries, linkModules }: { ctx: HomeContext; entries: (DayRow | AgendaPlaceholder)[]; linkModules: boolean }) {
  const { funnel, timeZone, carry } = ctx.loaded;
  return (
    <ol className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => {
        if (!("position" in entry)) {
          return (
            <li key={entry.id} className="pcf-content flex flex-col gap-1" style={entry.faded ? { opacity: 0.55 } : undefined}>
              <span className="pcf-thumb flex items-center justify-center bg-black/70 text-white" style={{ aspectRatio: "16 / 9" }} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
                </svg>
              </span>
              <span className="mt-2 text-xs font-bold uppercase tracking-wider opacity-70">{[entry.label || "Coming soon", entry.agendaWhen].filter(Boolean).join(" · ")}</span>
              <span className="font-semibold [overflow-wrap:anywhere]">{entry.title || entry.label || "Coming soon"}</span>
              {entry.agendaDesc ? <span className="text-sm [overflow-wrap:anywhere]">{entry.agendaDesc}</span> : null}
            </li>
          );
        }
        const index = ctx.loaded.days.findIndex((day) => day.id === entry.id);
        const state = ctx.states[index];
        const open = state ? isOpen(state) : false;
        const when = dayWhen(funnel, entry);
        const thumb = dayThumb(entry, ctx.base, state?.kind === "video");
        const body = (
          <>
            <span className="pcf-thumb relative block bg-black/80" style={{ aspectRatio: "16 / 9" }}>
              {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center text-sm font-bold text-white">{dayLabel(entry)}</span>}
              {!open ? <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">LOCKED</span> : null}
            </span>
            <span className="mt-2 block text-xs font-bold uppercase tracking-wider opacity-70">
              {dayLabel(entry)}
              {when ? ` · ${formatZoned(when, timeZone, { weekday: false })}` : ""}
            </span>
            <span className="block font-semibold [overflow-wrap:anywhere]">{entry.title || dayLabel(entry)}</span>
            {entry.topics.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {entry.topics.slice(0, 4).map((topic, position) => (
                  <li key={position} className="[overflow-wrap:anywhere]">
                    {topic}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        );
        return (
          <li key={entry.id} className="pcf-content">
            {linkModules && open ? (
              <a href={`${ctx.base}/day-${entry.position}${carry}`} className="block">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

function renderBlock(ctx: HomeContext, block: Block): ReactNode {
  const { funnel, timeZone, now } = ctx.loaded;
  const rules = funnelRules(funnel);
  const viewer = viewerFacts(ctx.viewer);
  const start = effectiveStart(rules, viewer, now);
  const { branding } = ctx.theme;
  switch (block.type) {
    case "headline":
      if (!block.heading && !block.accent && !block.sub) return null;
      return (
        <>
          <Eyebrow text={block.eyebrow} />
          <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-5xl">
            {block.heading}
            {block.accent ? <span className="pcf-accent"> {block.accent}</span> : null}
          </h1>
          {block.sub ? <p className="mt-4 whitespace-pre-line text-lg opacity-90 [overflow-wrap:anywhere]">{block.sub}</p> : null}
        </>
      );
    case "text": {
      const html = sanitizeRich(block.html);
      return html ? <Rich html={html} className="text-base sm:text-lg" /> : null;
    }
    case "event": {
      const at = block.at ? new Date(block.at) : start;
      const title = block.title || funnel.name;
      const event = eventBoxEvent({ funnelId: funnel.id, blockId: block.id, title, start: at, minutes: block.minutes, pageUrl: `${ctx.origin}/l/${funnel.slug}`, timeZone });
      const icsHref = `${ctx.base || `/l/${funnel.slug}`}/ics?block=${block.id}`;
      const when = block.when || (at ? formatZoned(at, timeZone) : "");
      const dark = block.style.bg ? block.style.bg : null;
      return (
        <div className="space-y-4">
          <Eyebrow text={block.eyebrow} />
          <h2 className="text-2xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-4xl">{title}</h2>
          {when ? <p className="text-base font-semibold opacity-90">{when}</p> : null}
          {block.countdown && at && at > now ? (
            <div className="mx-auto max-w-xl">
              <Countdown target={at.getTime()} labelColor="currentColor" boxColor="#ffffff" digitColor="#111827" reloadAtZero={false} />
            </div>
          ) : null}
          {block.calendar && event && at && at > now ? <AddToCalendar event={event} icsHref={icsHref} timeZone={timeZone} tone={dark ? "dark" : "light"} /> : null}
        </div>
      );
    }
    case "countdown": {
      const target = block.target === "custom" ? (block.at ? new Date(block.at) : null) : block.target === "end" ? effectiveEnd(rules, viewer, now) : start;
      if (!target || target <= now) return null;
      return (
        <>
          <Heading text={block.heading} />
          <div className="mx-auto max-w-xl">
            <Countdown target={target.getTime()} labelColor="currentColor" boxColor="#ffffff" digitColor="#111827" reloadAtZero={false} />
          </div>
        </>
      );
    }
    case "agenda": {
      const entries = agendaEntries(ctx.days, ctx.loaded.navItems);
      if (!entries.length) return null;
      if (block.layout === "list") return <Agenda funnel={funnel} days={entries} timeZone={timeZone} title={block.heading} />;
      return (
        <>
          <Heading text={block.heading} />
          <AgendaCards ctx={ctx} entries={entries} linkModules={block.linkModules} />
        </>
      );
    }
    case "optin": {
      if (block.mode === "sms") {
        const sms = smsFormFor(ctx.loaded, block.smsFormId);
        if (!sms) return null;
        return (
          <div id={`block-${block.id}`}>
            <Heading text={block.heading} />
            {block.intro ? <p className="mx-auto mb-4 max-w-xl whitespace-pre-line [overflow-wrap:anywhere]">{block.intro}</p> : null}
            <SmsSlot loaded={ctx.loaded} form={sms} base={ctx.base} back={ctx.base || "/"} query={ctx.query} />
          </div>
        );
      }
      const formReady = block.mode === "form" && block.formSlug;
      if (!formReady && block.mode === "form") return null;
      const back = ctx.base || "/";
      return (
        <div id={`block-${block.id}`}>
          <Heading text={block.heading} />
          {block.intro ? <p className="mx-auto mb-4 max-w-xl whitespace-pre-line [overflow-wrap:anywhere]">{block.intro}</p> : null}
          {formReady ? (
            <FormOptin src={orgPublicUrl(ctx.host, ctx.loaded.orgSlug, `/embed/${block.formSlug}`)} headline="" />
          ) : (
            <EmailOptin
              funnel={funnel}
              branding={branding}
              action={`${ctx.base || `/l/${funnel.slug}`}/optin`}
              back={back}
              joined={ctx.query.joined === "1"}
              error={ctx.query.error}
              headline=""
              buttonText={block.buttonText}
              idSuffix={`-${block.id}`}
            />
          )}
        </div>
      );
    }
    case "hosts":
      if (!ctx.loaded.hosts.length) return null;
      return (
        <>
          <Heading text={block.heading} />
          <HostCards funnel={funnel} hosts={ctx.loaded.hosts} layout={block.layout} />
        </>
      );
    case "button": {
      const link = resolveHref(ctx, block.target);
      if (!link || !block.label) return null;
      return (
        <a href={link.href} className="pcf-btn text-lg" {...(link.external && block.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {block.label}
        </a>
      );
    }
    case "image": {
      const src = block.assetId ? assetSrc(funnel, block.assetId) : block.src;
      if (!src) return null;
      const image = <img src={src} alt={block.alt} className="inline-block h-auto max-w-full rounded-lg" style={{ width: `${block.widthPercent}%` }} loading="lazy" />;
      const link = block.href ? resolveHref(ctx, block.href) : null;
      return link ? (
        <a href={link.href} {...(link.external && block.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {image}
        </a>
      ) : (
        image
      );
    }
    case "html":
      return block.html.trim() ? <HtmlFrame html={block.html} title={block.title} height={block.height} textColor={block.style.text ?? ctx.theme.design.page.text} linkColor={ctx.theme.design.page.accent} /> : null;
    case "divider":
      return <hr className="border-0 border-t border-current opacity-20" />;
  }
}

/** The microsite home page: its blocks, in order, each in its own styled band. */
export function HomeBlocks({ ctx, blocks }: { ctx: HomeContext; blocks: Block[] }) {
  return (
    <div>
      {blocks.map((block) => {
        const inner = renderBlock(ctx, block);
        if (!inner) return null;
        const max = WIDTH_PX[block.style.width];
        return (
          <section key={block.id} id={`b-${block.id}`} style={blockBandStyle(block.style)} data-block={block.type}>
            <div className={`mx-auto min-w-0 ${max ? "px-4" : ""}`} style={max ? { maxWidth: max } : undefined}>
              {inner}
            </div>
          </section>
        );
      })}
      {blocks.length === 0 ? <p className="px-4 py-16 text-center text-sm opacity-70">This page has no content yet.</p> : null}
    </div>
  );
}

export type { HomeContext };
