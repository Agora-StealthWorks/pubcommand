import { richToInput } from "@/features/funnels/sanitize";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { addDay, deleteDay, deleteFunnel, moveDay, publishFunnel, saveDay, saveFunnel } from "@/features/funnels/actions";
import { DeadlineTab, DesignTab, HomeTab, HostsTab, PagesTab } from "@/features/funnels/builder-tabs";
import { dayLabel, dayThumb, dayVideo, loadFunnelForBrand, orgTimezone, statusBadge, type DayRow, type FunnelRow } from "@/features/funnels/data";
import { Check, Field, LinkBox, Section } from "@/features/funnels/fields";
import { funnelCheckInput } from "@/features/funnels/site-data";
import { funnelsAccess, orgPublicUrl } from "@/features/funnels/guard";
import { SectionTabs } from "@/features/funnels/tabs";
import { checkFunnel, resourcesText } from "../../../../../../../../../modules/funnels/checks";
import { PROGRESSIONS, PROGRESSION_LABELS, SITE_TYPE_LABELS, type Progression } from "../../../../../../../../../modules/funnels/state";
import { utcToZonedLocal, zoneLabel } from "../../../../../../../../../modules/funnels/time";
import { watchUrl } from "../../../../../../../../../modules/funnels/video";

const TABS = [
  { key: "setup", label: "Setup" },
  { key: "days", label: "Days" },
  { key: "home", label: "Home page" },
  { key: "waitlist", label: "Waitlist" },
  { key: "hosts", label: "Hosts" },
  { key: "pages", label: "Pages & links" },
  { key: "deadline", label: "Deadline bar" },
  { key: "design", label: "Design" },
  { key: "close", label: "Close & messages" },
  { key: "publish", label: "Publish" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Hidden({ funnel, section }: { funnel: FunnelRow; section?: string }) {
  return (
    <>
      <input type="hidden" name="funnelId" value={funnel.id} />
      {section ? <input type="hidden" name="section" value={section} /> : null}
    </>
  );
}

export default async function FunnelBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; funnelId: string }>;
  searchParams: Promise<{ tab?: string; day?: string; host?: string; item?: string; error?: string; notice?: string }>;
}) {
  const { slug, funnelId } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canPublish } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) notFound();
  const { funnel, days, hosts, navItems } = loaded;
  const db = tenantDb(ctx.resolved.id);
  const [timeZone, themes, forms, otherFunnels] = await Promise.all([
    orgTimezone(ctx.resolved.id),
    db.formTheme.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.form.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, status: "OPEN" }, orderBy: { title: "asc" }, select: { slug: true, title: true } }),
    db.funnel.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, id: { not: funnel.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const microsite = funnel.siteType === "microsite";
  // A microsite's front door is the home page; a launch funnel's is the waitlist.
  const tabs = TABS.filter((item) => (microsite ? item.key !== "waitlist" : item.key !== "home"));
  const wanted = query.tab === "branding" ? "design" : query.tab === "home" && !microsite ? "waitlist" : query.tab === "waitlist" && microsite ? "home" : query.tab ?? "";
  const tab: Tab = (tabs.map((item) => item.key) as readonly string[]).includes(wanted) ? (wanted as Tab) : "setup";
  const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, `/l/${funnel.slug}`);
  const zone = zoneLabel(new Date(), timeZone);
  const local = (date: Date | null) => utcToZonedLocal(date, timeZone);
  const badge = statusBadge(funnel.status);
  const theme = funnel.formThemeId ? await db.formTheme.findFirst({ where: { id: funnel.formThemeId, deletedAt: null }, select: { privacyPolicyUrl: true } }) : null;
  const checks = checkFunnel(funnelCheckInput(funnel, days, navItems, theme?.privacyPolicyUrl ?? null));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/funnels" className="text-sm font-semibold text-accent">
            ← Launch funnels
          </Link>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{funnel.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <Badge tone="accent">{SITE_TYPE_LABELS[microsite ? "microsite" : "launch"]}</Badge>
            <span>{funnel.mode === "live" ? "Live sessions" : "Evergreen"}</span>
            <span>·</span>
            <span>{PROGRESSION_LABELS[(PROGRESSIONS as readonly string[]).includes(funnel.progression) ? (funnel.progression as Progression) : "all_open"]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${publicUrl}?preview=1`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
            Preview
          </a>
          <Link href={`/funnels/${funnel.id}/stats`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
            Stats
          </Link>
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <SectionTabs label="Builder sections" active={tab} items={tabs.map((item) => ({ key: item.key, label: item.label, href: `/funnels/${funnel.id}?tab=${item.key}` }))} />

      {tab === "setup" ? (
        <form action={saveFunnel} className="space-y-4">
          <Hidden funnel={funnel} section="setup" />
          <fieldset disabled={!canWrite} className="space-y-4">
            <Section title="Basics">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="name">
                  <Input id="name" name="name" defaultValue={funnel.name} maxLength={120} required />
                </Field>
                <Field label="Link name" htmlFor="slug" hint={`Public link: /l/${funnel.slug}`}>
                  <Input id="slug" name="slug" defaultValue={funnel.slug} maxLength={60} required pattern="[a-z0-9-]+" />
                </Field>
                <Field label="Type" htmlFor="siteType" hint="Launch: the front door is the waitlist, then day 1. Microsite: a home page you build from blocks is the front door, with the modules and pages around it. The close page takes over for both once it closes." className="sm:col-span-2">
                  <select id="siteType" name="siteType" defaultValue={microsite ? "microsite" : "launch"} className="pc-control w-full text-sm">
                    <option value="launch">Launch funnel (waitlist → day-by-day videos → close)</option>
                    <option value="microsite">Microsite (block-built home page)</option>
                  </select>
                </Field>
                <Field label="Kind" htmlFor="mode" hint="Live days send people to your livestream room while the session runs, then show the replay.">
                  <select id="mode" name="mode" defaultValue={funnel.mode} className="pc-control w-full text-sm">
                    <option value="evergreen">Evergreen (pre-recorded videos)</option>
                    <option value="live">Live sessions</option>
                  </select>
                </Field>
                <Field label="Build" htmlFor="buildMode" hint="Pre-built funnels can't publish until every video is in.">
                  <select id="buildMode" name="buildMode" defaultValue={funnel.buildMode} className="pc-control w-full text-sm">
                    <option value="as_you_go">As you go (days without a video say “coming soon”)</option>
                    <option value="prebuilt">Pre-built (every video first)</option>
                  </select>
                </Field>
              </div>
            </Section>
            <Section title="Timing" description={`Times are in the organization's time zone (${timeZone}, ${zone}).`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Clock" htmlFor="timing" hint="Live funnels always share one clock.">
                  <select id="timing" name="timing" defaultValue={funnel.timing} className="pc-control w-full text-sm">
                    <option value="fixed">Fixed dates (everyone together)</option>
                    <option value="per_viewer">Per viewer (starts on their first visit)</option>
                  </select>
                </Field>
                <Field label="Close after (hours, per viewer)" htmlFor="closeAfterHours" hint="Per-viewer funnels only. Empty = never closes.">
                  <Input id="closeAfterHours" name="closeAfterHours" type="number" min={1} defaultValue={funnel.closeAfterHours ?? ""} />
                </Field>
                <Field label={`Starts (${zone})`} htmlFor="startAt" hint="The waitlist counts down to this.">
                  <Input id="startAt" name="startAt" type="datetime-local" defaultValue={local(funnel.startAt)} />
                </Field>
                <Field label={`Closes (${zone})`} htmlFor="endAt" hint="Empty = stays open.">
                  <Input id="endAt" name="endAt" type="datetime-local" defaultValue={local(funnel.endAt)} />
                </Field>
                <Field label="Livestream room link" htmlFor="livestreamUrl" hint="Live funnels: the default room for live days." className="sm:col-span-2">
                  <Input id="livestreamUrl" name="livestreamUrl" type="url" defaultValue={funnel.livestreamUrl ?? ""} placeholder="https://" />
                </Field>
              </div>
            </Section>
            <Section title="Progression" description="How later days unlock. Day 1 is never locked, and live days follow their session times instead.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Unlock rule" htmlFor="progression">
                  <select id="progression" name="progression" defaultValue={funnel.progression} className="pc-control w-full text-sm">
                    {PROGRESSIONS.map((value) => (
                      <option key={value} value={value}>
                        {PROGRESSION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Watch threshold (%)" htmlFor="watchPercent" hint="“Unlock after watching”: how much of the previous day to watch. Also counts a video as finished in stats.">
                  <Input id="watchPercent" name="watchPercent" type="number" min={1} max={100} defaultValue={funnel.watchPercent} />
                </Field>
              </div>
              <p className="text-xs text-muted">Scheduled unlocks use each day’s “unlock after” hours (or exact time) on the Days tab. Link keys are on each day too: send <code>/l/{funnel.slug}/day-2?k=&lt;key&gt;</code> in your emails; the browser remembers it.</p>
            </Section>
            <Section title="Brain">
              <Check name="brainSyncEnabled" label="Teach the brand Brain when published" defaultChecked={funnel.brainSyncEnabled} hint="Agenda, structure and aggregate stats only. Never opt-in emails." />
            </Section>
            {canWrite ? <Button type="submit">Save setup</Button> : null}
          </fieldset>
        </form>
      ) : null}

      {tab === "days" ? (
        <div className="space-y-3">
          {days.map((day, index) => (
            <DayEditor key={day.id} funnel={funnel} day={day} open={query.day === day.id || (days.length === 1 && !query.day)} first={index === 0} last={index === days.length - 1} canWrite={canWrite} local={local} zone={zone} />
          ))}
          {canWrite ? (
            <form action={addDay}>
              <Hidden funnel={funnel} />
              <Button type="submit" variant="secondary">
                + Add a day
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === "waitlist" ? (
        <form action={saveFunnel} className="space-y-4">
          <Hidden funnel={funnel} section="waitlist" />
          <fieldset disabled={!canWrite} className="space-y-4">
            <Section title="Waitlist page" description="Shown at the funnel's link before it starts: a big countdown, then the agenda built from each day's title, date and topics.">
              <Check name="waitlistEnabled" label="Show the waitlist before the start" defaultChecked={funnel.waitlistEnabled} hint="Off: early visitors land on day 1, locked with a countdown." />
              <Field label="Headline" htmlFor="waitlistHeadline">
                <Input id="waitlistHeadline" name="waitlistHeadline" defaultValue={funnel.waitlistHeadline} maxLength={160} />
              </Field>
              <Field label="Subheadline" htmlFor="waitlistSubheadline">
                <Textarea id="waitlistSubheadline" name="waitlistSubheadline" defaultValue={funnel.waitlistSubheadline} maxLength={400} className="min-h-16" />
              </Field>
              <Field label="Agenda title" htmlFor="agendaTitle">
                <Input id="agendaTitle" name="agendaTitle" defaultValue={funnel.agendaTitle} maxLength={120} />
              </Field>
            </Section>
            <Section title="Opt-in" description="Optional. Reuse one of this brand's published forms, or collect just an email address.">
              <Field label="Opt-in on the waitlist" htmlFor="optinMode">
                <select id="optinMode" name="optinMode" defaultValue={funnel.optinMode} className="pc-control w-full text-sm">
                  <option value="none">None</option>
                  <option value="email">Simple email capture</option>
                  <option value="form" disabled={forms.length === 0}>
                    A published form{forms.length === 0 ? " (none published yet)" : ""}
                  </option>
                </select>
              </Field>
              {forms.length ? (
                <Field label="Form" htmlFor="optinFormSlug" hint="Embedded from Forms; responses are stored there.">
                  <select id="optinFormSlug" name="optinFormSlug" defaultValue={funnel.optinFormSlug ?? ""} className="pc-control w-full text-sm">
                    <option value="">Pick a form</option>
                    {forms.map((form) => (
                      <option key={form.slug} value={form.slug}>
                        {form.title}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Opt-in headline" htmlFor="optinHeadline">
                  <Input id="optinHeadline" name="optinHeadline" defaultValue={funnel.optinHeadline} maxLength={160} />
                </Field>
                <Field label="Button text (email capture)" htmlFor="optinButtonText">
                  <Input id="optinButtonText" name="optinButtonText" defaultValue={funnel.optinButtonText} maxLength={40} />
                </Field>
              </div>
            </Section>
            {canWrite ? <Button type="submit">Save waitlist</Button> : null}
          </fieldset>
        </form>
      ) : null}

      {tab === "home" ? <HomeTab funnel={funnel} days={days} navItems={navItems} hosts={hosts} forms={forms} timeZone={timeZone} zone={zone} canWrite={canWrite} /> : null}
      {tab === "hosts" ? <HostsTab funnel={funnel} hosts={hosts} openId={query.host} canWrite={canWrite} /> : null}
      {tab === "pages" ? <PagesTab funnel={funnel} days={days} navItems={navItems} forms={forms} openId={query.item} canWrite={canWrite} publicUrl={publicUrl} /> : null}
      {tab === "deadline" ? <DeadlineTab funnel={funnel} timeZone={timeZone} zone={zone} canWrite={canWrite} /> : null}
      {tab === "design" ? <DesignTab funnel={funnel} days={days} navItems={navItems} themes={themes} otherFunnels={otherFunnels} canWrite={canWrite} /> : null}

      {tab === "close" ? (
        <form action={saveFunnel} className="space-y-4">
          <Hidden funnel={funnel} section="close" />
          <fieldset disabled={!canWrite} className="space-y-4">
            <Section title="Close / order page" description="What visitors see once the funnel closes.">
              <Field label="When it closes" htmlFor="closeMode">
                <select id="closeMode" name="closeMode" defaultValue={funnel.closeMode} className="pc-control w-full text-sm">
                  <option value="page">Show the close page</option>
                  <option value="redirect">Send visitors to a web address</option>
                  <option value="never">Never close</option>
                </select>
              </Field>
              <Field label="Redirect to" htmlFor="closeRedirectUrl">
                <Input id="closeRedirectUrl" name="closeRedirectUrl" type="url" defaultValue={funnel.closeRedirectUrl ?? ""} placeholder="https://" />
              </Field>
              <Field label="Headline" htmlFor="closeHeadline">
                <Input id="closeHeadline" name="closeHeadline" defaultValue={funnel.closeHeadline} maxLength={160} />
              </Field>
              <Field label="Message" htmlFor="closeMessageHtml">
                <Textarea id="closeMessageHtml" name="closeMessageHtml" defaultValue={richToInput(funnel.closeMessageHtml)} className="min-h-24" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Button text" htmlFor="closeButtonText" hint="e.g. the order page. Optional.">
                  <Input id="closeButtonText" name="closeButtonText" defaultValue={funnel.closeButtonText ?? ""} maxLength={60} />
                </Field>
                <Field label="Button link" htmlFor="closeButtonUrl">
                  <Input id="closeButtonUrl" name="closeButtonUrl" type="url" defaultValue={funnel.closeButtonUrl ?? ""} placeholder="https://" />
                </Field>
              </div>
            </Section>
            <Section title="Day messages" description="Tokens: {day} {prev_day} {percent} {unlock_date}.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Locked title" htmlFor="lockedTitle">
                  <Input id="lockedTitle" name="lockedTitle" defaultValue={funnel.lockedTitle} />
                </Field>
                <Field label="Locked: scheduled / not started" htmlFor="lockedScheduledMsg">
                  <Input id="lockedScheduledMsg" name="lockedScheduledMsg" defaultValue={funnel.lockedScheduledMsg} />
                </Field>
                <Field label="Locked: watch the previous day" htmlFor="lockedWatchMsg">
                  <Input id="lockedWatchMsg" name="lockedWatchMsg" defaultValue={funnel.lockedWatchMsg} />
                </Field>
                <Field label="Locked: link key" htmlFor="lockedKeyMsg">
                  <Input id="lockedKeyMsg" name="lockedKeyMsg" defaultValue={funnel.lockedKeyMsg} />
                </Field>
                <Field label="Locked: live session ahead" htmlFor="lockedLiveMsg">
                  <Input id="lockedLiveMsg" name="lockedLiveMsg" defaultValue={funnel.lockedLiveMsg} />
                </Field>
                <Field label="Next-day button" htmlFor="nextButtonText">
                  <Input id="nextButtonText" name="nextButtonText" defaultValue={funnel.nextButtonText} />
                </Field>
                <Field label="Coming soon: title" htmlFor="comingSoonTitle">
                  <Input id="comingSoonTitle" name="comingSoonTitle" defaultValue={funnel.comingSoonTitle} />
                </Field>
                <Field label="Coming soon: message" htmlFor="comingSoonMessage">
                  <Input id="comingSoonMessage" name="comingSoonMessage" defaultValue={funnel.comingSoonMessage} />
                </Field>
                <Field label="Replay pending: title" htmlFor="replayPendingTitle">
                  <Input id="replayPendingTitle" name="replayPendingTitle" defaultValue={funnel.replayPendingTitle} />
                </Field>
                <Field label="Replay pending: message" htmlFor="replayPendingMessage">
                  <Input id="replayPendingMessage" name="replayPendingMessage" defaultValue={funnel.replayPendingMessage} />
                </Field>
                <Field label="Live: headline" htmlFor="liveHeadline">
                  <Input id="liveHeadline" name="liveHeadline" defaultValue={funnel.liveHeadline} />
                </Field>
                <Field label="Live: subheadline" htmlFor="liveSubheadline">
                  <Input id="liveSubheadline" name="liveSubheadline" defaultValue={funnel.liveSubheadline} />
                </Field>
              </div>
            </Section>
            {canWrite ? <Button type="submit">Save messages</Button> : null}
          </fieldset>
        </form>
      ) : null}

      {tab === "publish" ? (
        <div className="space-y-4">
          <Section title="Links">
            <div className="grid gap-4 sm:grid-cols-2">
              <LinkBox label="Public link" value={publicUrl} />
              <LinkBox label="Day 1" value={`${publicUrl}/day-1`} />
            </div>
            <form action={publicUrl} method="get" target="_blank" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="preview" value="1" />
              <Field label={`Preview as of (${zone})`} htmlFor="as_of" hint="Time travel: see exactly what a visitor would see at that moment. Drafts work too.">
                <Input id="as_of" name="as_of" type="datetime-local" defaultValue={local(funnel.startAt ?? new Date())} />
              </Field>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="fresh" value="1" defaultChecked className="h-4 w-4 accent-accent" /> As a new visitor
              </label>
              <Button type="submit" variant="secondary" className="mb-0.5">
                Open preview
              </Button>
            </form>
          </Section>
          <Section title="Publish checks" description="Errors block publishing. A published funnel stays live while you edit it.">
            {checks.errors.length === 0 && checks.warnings.length === 0 ? <p className="text-sm text-[#067647]">All checks pass.</p> : null}
            {checks.errors.length ? (
              <ul className="space-y-1 text-sm text-[#912018]">
                {checks.errors.map((error) => (
                  <li key={error}>✕ {error}</li>
                ))}
              </ul>
            ) : null}
            {checks.warnings.length ? (
              <ul className="space-y-1 text-sm text-[#93370d]">
                {checks.warnings.map((warning) => (
                  <li key={warning}>! {warning}</li>
                ))}
              </ul>
            ) : null}
            {canPublish ? (
              <form action={publishFunnel} className="flex flex-wrap gap-2">
                <Hidden funnel={funnel} />
                {funnel.status === "published" ? (
                  <Button type="submit" name="intent" value="unpublish" variant="secondary">
                    Unpublish
                  </Button>
                ) : (
                  <Button type="submit" name="intent" value="publish" disabled={checks.errors.length > 0}>
                    Publish
                  </Button>
                )}
              </form>
            ) : (
              <p className="text-sm text-muted">Publishing needs the funnels.publish permission.</p>
            )}
          </Section>
          {canPublish ? (
            <Section title="Opt-ins" description="Email opt-ins captured on the waitlist. They are personal data: the CSV is for this team only.">
              <a href={`/funnels/${funnel.id}/optins`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
                Download opt-ins (CSV)
              </a>
            </Section>
          ) : null}
          {canPublish ? (
            <Section title="Delete">
              <form action={deleteFunnel} className="flex flex-wrap items-end gap-2">
                <Hidden funnel={funnel} />
                <Field label={`Type “${funnel.name}” to delete`} htmlFor="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" />
                </Field>
                <Button type="submit" variant="danger" className="mb-0.5">
                  Delete funnel
                </Button>
              </form>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DayEditor({
  funnel,
  day,
  open,
  first,
  last,
  canWrite,
  local,
  zone,
}: {
  funnel: FunnelRow;
  day: DayRow;
  open: boolean;
  first: boolean;
  last: boolean;
  canWrite: boolean;
  local: (date: Date | null) => string;
  zone: string;
}) {
  const video = dayVideo(day);
  const thumb = dayThumb(day, `/l/${funnel.slug}`, true);
  const live = funnel.mode === "live";
  return (
    <details id={`day-${day.id}`} open={open} className="rounded-xl border border-line bg-white">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <span className="relative block w-24 shrink-0 overflow-hidden rounded-md bg-canvas" style={{ aspectRatio: "16 / 9" }}>
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-muted">No video</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted">
            {dayLabel(day)}
            {live && day.isLive ? " · Live" : ""}
          </span>
          <span className="block truncate font-semibold">{day.title || "Untitled"}</span>
          <span className="block truncate text-xs text-muted">{video ? `${video.provider === "youtube" ? "YouTube" : "Wistia"} · ${day.videoTitle ?? video.id}` : "No video yet"}</span>
        </span>
      </summary>
      <div className="border-t border-line p-4">
        <form action={saveDay} encType="multipart/form-data" className="space-y-4">
          <input type="hidden" name="funnelId" value={funnel.id} />
          <input type="hidden" name="dayId" value={day.id} />
          <fieldset disabled={!canWrite} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor={`title-${day.id}`}>
                <Input id={`title-${day.id}`} name="title" defaultValue={day.title} maxLength={160} />
              </Field>
              <Field label="Nav label" htmlFor={`nav-${day.id}`} hint={`Default “Day ${day.position}”.`}>
                <Input id={`nav-${day.id}`} name="navLabel" defaultValue={day.navLabel ?? ""} maxLength={40} />
              </Field>
              <Field label="Video (Wistia or YouTube link)" htmlFor={`video-${day.id}`} hint={video ? <a className="text-accent underline" href={watchUrl(video)} target="_blank" rel="noopener">Open the video</a> : "Title and thumbnail fill in automatically."} className="sm:col-span-2">
                <Input id={`video-${day.id}`} name="video" defaultValue={video ? watchUrl(video) : ""} placeholder="https://youtu.be/… or https://…wistia.com/medias/…" />
              </Field>
              <Field label="Thumbnail upload" htmlFor={`thumb-${day.id}`} hint="Overrides the automatic one.">
                <input id={`thumb-${day.id}`} name="thumb" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
              </Field>
              <Field label="…or thumbnail link" htmlFor={`thumbUrl-${day.id}`}>
                <Input id={`thumbUrl-${day.id}`} name="thumbUrl" type="url" defaultValue={day.thumbUrl ?? ""} placeholder="https://" />
              </Field>
            </div>
            {day.thumbAssetId ? <Check name="removeThumb" label="Remove the uploaded thumbnail" defaultChecked={false} /> : null}
            <Field label="Agenda topics" htmlFor={`topics-${day.id}`} hint="One per line. Shown in the waitlist agenda.">
              <Textarea id={`topics-${day.id}`} name="topics" defaultValue={day.topics.join("\n")} className="min-h-20" />
            </Field>
            <Field label="Notes under the video" htmlFor={`body-${day.id}`} hint="Plain text or simple HTML (sanitized).">
              <Textarea id={`body-${day.id}`} name="bodyHtml" defaultValue={richToInput(day.bodyHtml)} className="min-h-20" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Resources heading" htmlFor={`resh-${day.id}`}>
                <Input id={`resh-${day.id}`} name="resourcesHeading" defaultValue={day.resourcesHeading} maxLength={80} />
              </Field>
              <Field label="Resources" htmlFor={`res-${day.id}`} hint="One per line: Label | https://…">
                <Textarea id={`res-${day.id}`} name="resources" defaultValue={resourcesText(day.resources)} className="min-h-16" />
              </Field>
            </div>

            <fieldset className="rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">Unlock</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Unlock after (hours from start)" htmlFor={`off-${day.id}`} hint="Scheduled progression.">
                  <Input id={`off-${day.id}`} name="unlockOffsetHours" type="number" min={0} defaultValue={day.unlockOffsetHours} />
                </Field>
                <Field label={`…or exactly at (${zone})`} htmlFor={`uat-${day.id}`}>
                  <Input id={`uat-${day.id}`} name="unlockAt" type="datetime-local" defaultValue={local(day.unlockAt)} />
                </Field>
                <Field label="Link key" htmlFor={`key-${day.id}`} hint={`?k=${day.unlockKey}`}>
                  <Input id={`key-${day.id}`} name="unlockKey" defaultValue={day.unlockKey} maxLength={40} />
                </Field>
              </div>
            </fieldset>

            {live ? (
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-sm font-semibold">Live session</legend>
                <Check name="isLive" label="This day is a live session" defaultChecked={day.isLive} />
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label={`Starts (${zone})`} htmlFor={`ls-${day.id}`}>
                    <Input id={`ls-${day.id}`} name="liveStartAt" type="datetime-local" defaultValue={local(day.liveStartAt)} />
                  </Field>
                  <Field label={`Ends (${zone})`} htmlFor={`le-${day.id}`} hint="Empty = 2 hours.">
                    <Input id={`le-${day.id}`} name="liveEndAt" type="datetime-local" defaultValue={local(day.liveEndAt)} />
                  </Field>
                  <Field label="Room link" htmlFor={`lu-${day.id}`} hint="Empty = the funnel's livestream room.">
                    <Input id={`lu-${day.id}`} name="liveUrl" type="url" defaultValue={day.liveUrl ?? ""} placeholder="https://" />
                  </Field>
                  <Field label="Override" htmlFor={`lo-${day.id}`}>
                    <select id={`lo-${day.id}`} name="liveOverride" defaultValue={day.liveOverride} className="pc-control w-full text-sm">
                      <option value="auto">Automatic (by the times)</option>
                      <option value="on">Force “live now”</option>
                      <option value="off">Never live (cancelled)</option>
                    </select>
                  </Field>
                </div>
              </fieldset>
            ) : (
              <input type="hidden" name="isLive" value={day.isLive ? "on" : ""} />
            )}

            <fieldset className="rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">Call to action</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Show" htmlFor={`cr-${day.id}`}>
                  <select id={`cr-${day.id}`} name="ctaReveal" defaultValue={day.ctaReveal} className="pc-control w-full text-sm">
                    <option value="none">No button</option>
                    <option value="always">Always</option>
                    <option value="video_time">After N seconds of the video</option>
                    <option value="datetime">From a date and time</option>
                  </select>
                </Field>
                <Field label="Seconds into the video" htmlFor={`cs-${day.id}`}>
                  <Input id={`cs-${day.id}`} name="ctaSeconds" type="number" min={0} defaultValue={day.ctaSeconds} />
                </Field>
                <Field label={`From (${zone})`} htmlFor={`ca-${day.id}`}>
                  <Input id={`ca-${day.id}`} name="ctaAt" type="datetime-local" defaultValue={local(day.ctaAt)} />
                </Field>
                <Field label="Button text" htmlFor={`ct-${day.id}`}>
                  <Input id={`ct-${day.id}`} name="ctaText" defaultValue={day.ctaText} maxLength={80} />
                </Field>
                <Field label="Button link" htmlFor={`cu-${day.id}`}>
                  <Input id={`cu-${day.id}`} name="ctaUrl" type="url" defaultValue={day.ctaUrl} placeholder="https://" />
                </Field>
                <Field label="Small print under the button" htmlFor={`csub-${day.id}`}>
                  <Input id={`csub-${day.id}`} name="ctaSubtext" defaultValue={day.ctaSubtext} maxLength={200} />
                </Field>
              </div>
            </fieldset>
            {canWrite ? <Button type="submit">Save {dayLabel(day)}</Button> : null}
          </fieldset>
        </form>
        {canWrite ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {!first ? (
              <form action={moveDay}>
                <input type="hidden" name="funnelId" value={funnel.id} />
                <input type="hidden" name="dayId" value={day.id} />
                <Button type="submit" name="direction" value="up" variant="secondary" size="sm">
                  ↑ Move up
                </Button>
              </form>
            ) : null}
            {!last ? (
              <form action={moveDay}>
                <input type="hidden" name="funnelId" value={funnel.id} />
                <input type="hidden" name="dayId" value={day.id} />
                <Button type="submit" name="direction" value="down" variant="secondary" size="sm">
                  ↓ Move down
                </Button>
              </form>
            ) : null}
            <form action={deleteDay}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <input type="hidden" name="dayId" value={day.id} />
              <Button type="submit" variant="danger" size="sm">
                Remove day
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </details>
  );
}
