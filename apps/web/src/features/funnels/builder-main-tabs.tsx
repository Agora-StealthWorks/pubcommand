import { Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { describeReminders, parseReminders } from "../../../../../modules/funnels/calendar";
import type { CheckResult } from "../../../../../modules/funnels/checks";
import { linkItems, type LinkItem } from "../../../../../modules/funnels/links";
import { keyUnlocks, PROGRESSION_LABELS, PROGRESSIONS, scheduledUnlock } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { PROGRESS_SOURCE, PROVIDER_LABELS, formatDuration, watchUrl } from "../../../../../modules/funnels/video";
import { addDay, deleteDay, moveDay, saveDay, saveFunnel, setAgendaOnAllDays } from "./actions";
import { dayLabel, dayThumb, dayVideo, hasBody, isTextModule, type DayRow, type FunnelRow } from "./data";
import { Check, Field, LinkBox, Section } from "./fields";
import { RichTextArea } from "./rich-text-area";
import type { FunnelLinks } from "./guard";

type Local = (date: Date | null) => string;

function Hidden({ funnel, section }: { funnel: FunnelRow; section: string }) {
  return (
    <>
      <input type="hidden" name="funnelId" value={funnel.id} />
      <input type="hidden" name="section" value={section} />
    </>
  );
}

function Select({ id, name, value, options, disabled }: { id?: string; name: string; value: string; options: [string, string][]; disabled?: boolean }) {
  return (
    <select id={id ?? name} name={name} defaultValue={value} className="pc-control w-full text-sm" disabled={disabled}>
      {options.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** A colour that may be left blank ("follow the design"). A text box so blank stays possible. */
function ColorText({ name, label, value, hint }: { name: string; label: string; value: string | null; hint?: string }) {
  return (
    <Field label={label} htmlFor={name} hint={hint ?? "#rrggbb, or blank"}>
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 shrink-0 rounded-md border border-line" style={{ background: value && /^#[0-9a-f]{6}$/i.test(value) ? value : "transparent" }} aria-hidden="true" />
        <Input id={name} name={name} defaultValue={value ?? ""} maxLength={7} placeholder="#rrggbb" pattern="#[0-9a-fA-F]{6}" className="font-mono" />
      </div>
    </Field>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <p className={`rounded-lg border px-3 py-2 text-sm ${tone === "warn" ? "border-[#fedf89] bg-[#fffaeb] text-[#93370d]" : "border-[#c7d7fe] bg-[#eef4ff] text-[#1e3a8a]"}`}>{children}</p>;
}

function Save({ canWrite, children = "Save" }: { canWrite: boolean; children?: ReactNode }) {
  return canWrite ? <Button type="submit">{children}</Button> : null;
}

/** Link rows (resources, homework): the saved ones plus three empty rows. Empty rows are ignored on save. */
function LinkRows({ prefix, items, label }: { prefix: string; items: LinkItem[]; label: string }) {
  const rows: (LinkItem | null)[] = [...items, null, null, null].slice(0, 20);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{label}</legend>
      <p className="text-xs text-muted">Empty rows are ignored. Clear a link to remove it. “Locked teaser” shows a lock (e.g. Download transcript) and can link to <code>#offer</code>, the offer section on the page.</p>
      {rows.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_130px_auto] sm:items-center sm:border-0 sm:p-0">
          <Input name={`${prefix}_label_${index}`} defaultValue={item?.label ?? ""} placeholder="Label" maxLength={200} aria-label={`Label ${index + 1}`} />
          <Input name={`${prefix}_url_${index}`} defaultValue={item?.url ?? ""} placeholder="https:// or #offer" inputMode="url" aria-label={`Link ${index + 1}`} />
          <select name={`${prefix}_style_${index}`} defaultValue={item?.style ?? "button"} className="pc-control text-sm" aria-label={`Style ${index + 1}`}>
            <option value="button">Button</option>
            <option value="link">Text link</option>
            <option value="locked">Locked teaser</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={`${prefix}_newTab_${index}`} defaultChecked={item ? item.newTab : true} className="h-4 w-4 accent-accent" /> New tab
          </label>
        </div>
      ))}
    </fieldset>
  );
}

export function ChecksList({ checks }: { checks: CheckResult }) {
  return (
    <>
      {checks.errors.length === 0 && checks.warnings.length === 0 ? <p className="text-sm text-[#067647]">Ready to publish.</p> : null}
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
    </>
  );
}

/** Setup: the publish checklist, name, link and where it lives (custom domain). */
export function SetupTab({ funnel, canWrite, checks, publicUrl, domains }: { funnel: FunnelRow; canWrite: boolean; checks: CheckResult; publicUrl: string; domains: { hostname: string; status: string }[] }) {
  return (
    <div className="space-y-4">
      <Section title="Publish checklist" description="Errors block publishing. Checks refresh when you save.">
        <ChecksList checks={checks} />
      </Section>
      <form action={saveFunnel} className="space-y-4">
        <Hidden funnel={funnel} section="setup" />
        <fieldset disabled={!canWrite} className="space-y-4">
          <Section title="General">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Funnel title" htmlFor="name" hint="Browser tab and internal name.">
                <Input id="name" name="name" defaultValue={funnel.name} maxLength={120} required />
              </Field>
              <Field label="Link name" htmlFor="slug" hint={`Public link: /l/${funnel.slug}`}>
                <Input id="slug" name="slug" defaultValue={funnel.slug} maxLength={60} required pattern="[a-z0-9-]+" />
              </Field>
            </div>
            <Check name="brainSyncEnabled" label="Teach the brand Brain about this funnel when published" defaultChecked={funnel.brainSyncEnabled} hint="Its structure and agenda only. Never visitor traffic, opt-ins or contact details." />
          </Section>
          <Save canWrite={canWrite} />
        </fieldset>
      </form>
      <Section title="Custom domain" description="Serve this funnel on its own domain: the front door at / and the modules at /day-1, /day-2…">
        {domains.length ? (
          <ul className="space-y-1 text-sm">
            {domains.map((domain) => (
              <li key={domain.hostname} className="flex flex-wrap items-center gap-2">
                <a href={`https://${domain.hostname}`} target="_blank" rel="noopener" className="font-mono font-semibold text-accent">
                  {domain.hostname}
                </a>
                <span className="text-xs text-muted">{domain.status === "ACTIVE" ? "Live" : domain.status.replace(/_/g, " ").toLowerCase()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No domain points here yet.</p>
        )}
        {domains.length && funnel.status !== "published" ? <Note tone="warn">This funnel is a draft, so its domain shows “not found” to the public until you publish it. Preview it from here.</Note> : null}
        <p className="text-sm">
          Add or connect one in{" "}
          <Link href="/settings/domains" className="font-semibold text-accent">
            Settings → Domains
          </Link>{" "}
          and point it at <code className="rounded bg-canvas px-1">/l/{funnel.slug}</code>.
          {domains.some((domain) => domain.status === "ACTIVE") ? (
            <> Links and previews use <a href={publicUrl} className="break-all text-accent">{publicUrl}</a>.</>
          ) : (
            <> Until DNS works, use <a href={publicUrl} className="break-all text-accent">{publicUrl}</a>.</>
          )}
        </p>
      </Section>
    </div>
  );
}

/** Mode & schedule: type, evergreen / live, calendar, between sessions, countdowns, timing, closing. */
export function ScheduleTab({ funnel, canWrite, local, zone, timeZone }: { funnel: FunnelRow; canWrite: boolean; local: Local; zone: string; timeZone: string }) {
  const live = funnel.mode === "live";
  const perViewer = !live && funnel.timing === "per_viewer";
  const reminders = parseReminders(funnel.calReminders);
  return (
    <form action={saveFunnel} className="space-y-4">
      <Hidden funnel={funnel} section="schedule" />
      <fieldset disabled={!canWrite} className="space-y-4">
        <Section title="Funnel type">
          <Field label="Type" htmlFor="siteType" hint="Launch funnel: a waitlist countdown before the start, then the module videos. Microsite: a home page you build from blocks is the front door, with the modules and pages around it.">
            <Select name="siteType" value={funnel.siteType === "microsite" ? "microsite" : "launch"} options={[["launch", "Launch funnel"], ["microsite", "Microsite"]]} />
          </Field>
        </Section>
        <Section title="Mode" description={`All times are in the organization's time zone (${timeZone}, ${zone}).`}>
          <Field label="Mode" htmlFor="mode" hint="Live: during a session the module page says “We're live” and sends visitors to the livestream room; afterwards the replay page takes over.">
            <Select name="mode" value={funnel.mode} options={[["evergreen", "Evergreen (pre-recorded videos)"], ["live", "Live (livestream sessions, then replays)"]]} />
          </Field>
          <Field label="Default livestream room" htmlFor="livestreamUrl" hint="Live funnels. Each live module can use its own room.">
            <Input id="livestreamUrl" name="livestreamUrl" type="url" defaultValue={funnel.livestreamUrl ?? ""} placeholder="https://" />
          </Field>
          {live ? (
            <>
              <h3 className="pt-2 text-sm font-semibold">Add to calendar</h3>
              <Check name="calendarEnabled" label="Show an Add to calendar button for upcoming live sessions" defaultChecked={funnel.calendarEnabled} hint="On a live module's page and the waitlist until the session starts. Never while it is live or afterwards." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Button type" htmlFor="calendarMode">
                  <Select name="calendarMode" value={funnel.calendarMode} options={[["builtin", "Built-in (Google, Apple, Outlook)"], ["url", "A link to your calendar tool"]]} />
                </Field>
                <Field label="Button text" htmlFor="calendarButtonText">
                  <Input id="calendarButtonText" name="calendarButtonText" defaultValue={funnel.calendarButtonText} maxLength={80} />
                </Field>
                <Field label="Calendar link" htmlFor="calendarUrl" hint="Link mode. Each live module can override it." className="sm:col-span-2">
                  <Input id="calendarUrl" name="calendarUrl" type="url" defaultValue={funnel.calendarUrl ?? ""} placeholder="https://" />
                </Field>
                <Field advanced label="Invite covers" htmlFor="calInviteScope" hint="Built-in mode. Series: Apple and Outlook get one file with every remaining session; Google lists one link per session.">
                  <Select name="calInviteScope" value={funnel.calInviteScope} options={[["individual", "Each session on its own (waitlist adds the first)"], ["series", "The whole series in one invite"]]} />
                </Field>
                <Field advanced label="Reminders before the session" htmlFor="calReminders" hint={`Comma-separated, up to 5, e.g. 1 day, 1 hour, 15 min. Now: ${describeReminders(reminders)}. Apple and Outlook only (Google uses its own alerts).`}>
                  <Input id="calReminders" name="calReminders" defaultValue={reminders.join(", ")} maxLength={200} />
                </Field>
                <Field advanced label="Invite title" htmlFor="calInviteTitle" hint="{funnel} {day} {title}" className="sm:col-span-2">
                  <Input id="calInviteTitle" name="calInviteTitle" defaultValue={funnel.calInviteTitle} maxLength={300} />
                </Field>
                <Field advanced label="Invite description" htmlFor="calInviteDesc" hint="{agenda} every session with its date and topics · {topics} this session's topics · {room_url} {page_url} {day} {title} {date} {time}. The event's location is always the session's room." className="sm:col-span-2">
                  <Textarea id="calInviteDesc" name="calInviteDesc" defaultValue={funnel.calInviteDesc} className="min-h-28" />
                </Field>
              </div>
              <h3 className="pt-2 text-sm font-semibold">Between sessions</h3>
              <Field label="Between sessions, the funnel's link sends people to…" htmlFor="betweenSessions">
                <Select
                  name="betweenSessions"
                  value={funnel.betweenSessions}
                  options={[
                    ["hybrid", "Hybrid (default): the most recent session, then the next one on its day"],
                    ["recent", "The most recent session (its replay, or “replay on its way”)"],
                    ["next", "The next session (its countdown and calendar button)"],
                  ]}
                />
              </Field>
              <h3 className="pt-2 text-sm font-semibold">Session-day countdown</h3>
              <Check name="liveCountdown" label="Count down in the video box on the day of a live session" defaultChecked={funnel.liveCountdown} hint="Opening Day 2 at 6 am when it goes live at noon shows 6 hours. At zero the page goes live and sends people to the room. A later session only counts down once every earlier one is over." />
              <Field label="Countdown title" htmlFor="liveCountdownTitle">
                <Input id="liveCountdownTitle" name="liveCountdownTitle" defaultValue={funnel.liveCountdownTitle} maxLength={200} />
              </Field>
              <h3 className="pt-2 text-sm font-semibold">Join today&apos;s session</h3>
              <Check advanced name="todayTrainingEnabled" label="On a later session's page, point people to today's session while it is still to come or live" defaultChecked={funnel.todayTrainingEnabled} hint="Someone opens Day 2 on the morning of Day 1: they see Day 2's date and a button to Day 1." />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field advanced label="Button text" htmlFor="todayTrainingText">
                  <Input id="todayTrainingText" name="todayTrainingText" defaultValue={funnel.todayTrainingText} maxLength={120} />
                </Field>
                <Field advanced label="Before it starts" htmlFor="todayTrainingMsg" hint="{day} {time}">
                  <Input id="todayTrainingMsg" name="todayTrainingMsg" defaultValue={funnel.todayTrainingMsg} maxLength={500} />
                </Field>
                <Field advanced label="While it is live" htmlFor="todayTrainingLiveMsg" hint="{day}">
                  <Input id="todayTrainingLiveMsg" name="todayTrainingLiveMsg" defaultValue={funnel.todayTrainingLiveMsg} maxLength={500} />
                </Field>
              </div>
              <h3 className="pt-2 text-sm font-semibold">Join the room early</h3>
              <Check advanced name="earlyJoinEnabled" label="Show a “join early” button shortly before a session goes live" defaultChecked={funnel.earlyJoinEnabled} hint="Replaces Add to calendar on the waitlist page and in the session-day countdown. It appears by itself at the right moment. Clicks are counted." />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field advanced label="Minutes before going live" htmlFor="earlyJoinMinutes">
                  <Input id="earlyJoinMinutes" name="earlyJoinMinutes" type="number" min={1} max={1440} defaultValue={funnel.earlyJoinMinutes} />
                </Field>
                <Field advanced label="Button text" htmlFor="earlyJoinText">
                  <Input id="earlyJoinText" name="earlyJoinText" defaultValue={funnel.earlyJoinText} maxLength={120} />
                </Field>
                <Field advanced label="Room link" htmlFor="earlyJoinUrl" hint="Blank = the session's livestream room.">
                  <Input id="earlyJoinUrl" name="earlyJoinUrl" type="url" defaultValue={funnel.earlyJoinUrl ?? ""} placeholder="https://" />
                </Field>
              </div>
              <Note>Mark which modules are live, and their session times, under Modules. Once a replay video is added the module becomes a normal page. When every replay is up you can switch this funnel to Evergreen.</Note>
            </>
          ) : (
            <>
              {[
                ["calendarEnabled", funnel.calendarEnabled],
                ["liveCountdown", funnel.liveCountdown],
                ["todayTrainingEnabled", funnel.todayTrainingEnabled],
                ["earlyJoinEnabled", funnel.earlyJoinEnabled],
              ].map(([name, on]) => (on ? <input key={String(name)} type="hidden" name={String(name)} value="on" /> : null))}
              {(
                [
                  ["calendarMode", funnel.calendarMode],
                  ["calendarButtonText", funnel.calendarButtonText],
                  ["calendarUrl", funnel.calendarUrl ?? ""],
                  ["calInviteScope", funnel.calInviteScope],
                  ["calInviteTitle", funnel.calInviteTitle],
                  ["calInviteDesc", funnel.calInviteDesc],
                  ["calReminders", funnel.calReminders],
                  ["betweenSessions", funnel.betweenSessions],
                  ["liveCountdownTitle", funnel.liveCountdownTitle],
                  ["todayTrainingText", funnel.todayTrainingText],
                  ["todayTrainingMsg", funnel.todayTrainingMsg],
                  ["todayTrainingLiveMsg", funnel.todayTrainingLiveMsg],
                  ["earlyJoinMinutes", String(funnel.earlyJoinMinutes)],
                  ["earlyJoinText", funnel.earlyJoinText],
                  ["earlyJoinUrl", funnel.earlyJoinUrl ?? ""],
                ] as const
              ).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
            </>
          )}
        </Section>
        <Section title="Timing" description={live ? "Live funnels always use fixed dates." : undefined}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clock" htmlFor="timing" hint="Per viewer: each visitor's clock starts on their first visit; unlock and close times count from then.">
              <Select name="timing" value={funnel.timing} options={[["fixed", "Fixed dates (everyone together)"], ["per_viewer", "Per viewer (starts on their first visit)"]]} disabled={live} />
              {live ? <input type="hidden" name="timing" value={funnel.timing} /> : null}
            </Field>
            {perViewer ? (
              <Field label="Close after (hours from first visit)" htmlFor="closeAfterHours" hint="Blank = never.">
                <Input id="closeAfterHours" name="closeAfterHours" type="number" min={1} defaultValue={funnel.closeAfterHours ?? ""} />
              </Field>
            ) : (
              <input type="hidden" name="closeAfterHours" value={funnel.closeAfterHours ?? ""} />
            )}
            {!perViewer ? (
              <>
                <Field label={`Funnel starts (${zone})`} htmlFor="startAt" hint="The waitlist counts down to this.">
                  <Input id="startAt" name="startAt" type="datetime-local" defaultValue={local(funnel.startAt)} />
                </Field>
                <Field label={`Funnel ends (${zone})`} htmlFor="endAt" hint="When the close behaviour kicks in.">
                  <Input id="endAt" name="endAt" type="datetime-local" defaultValue={local(funnel.endAt)} />
                </Field>
              </>
            ) : (
              <>
                <input type="hidden" name="startAt" value={local(funnel.startAt)} />
                <input type="hidden" name="endAt" value={local(funnel.endAt)} />
              </>
            )}
          </div>
        </Section>
        <Section title="When the funnel closes">
          <Field label="Close behaviour" htmlFor="closeMode" hint="Close page: a closed message with an optional button (Close page tab). Redirect: straight to another address. Never: pages stay up.">
            <Select name="closeMode" value={funnel.closeMode} options={[["page", "Show the close page"], ["redirect", "Redirect to a web address"], ["never", "Never close"]]} />
          </Field>
          <Field label="Redirect to" htmlFor="closeRedirectUrl">
            <Input id="closeRedirectUrl" name="closeRedirectUrl" type="url" defaultValue={funnel.closeRedirectUrl ?? ""} placeholder="https://" />
          </Field>
        </Section>
        <Save canWrite={canWrite} />
      </fieldset>
    </form>
  );
}

/** Progression, build mode and every page message. */
export function ProgressionTab({ funnel, canWrite }: { funnel: FunnelRow; canWrite: boolean }) {
  const messages: [string, string, string][] = [
    ["comingSoonTitle", "Coming soon title", funnel.comingSoonTitle],
    ["comingSoonMessage", "Coming soon message", funnel.comingSoonMessage],
    ["liveHeadline", "Live headline", funnel.liveHeadline],
    ["liveSubheadline", "Live subheadline", funnel.liveSubheadline],
    ["replayPendingTitle", "Replay pending title", funnel.replayPendingTitle],
    ["replayPendingMessage", "Replay pending message", funnel.replayPendingMessage],
    ["nextButtonText", "Next-day button", funnel.nextButtonText],
    ["prevButtonText", "Previous-day button (shown on locked modules)", funnel.prevButtonText],
  ];
  return (
    <form action={saveFunnel} className="space-y-4">
      <Hidden funnel={funnel} section="progression" />
      <fieldset disabled={!canWrite} className="space-y-4">
        <Section title="Progression" description="How later modules unlock. The first module opens at the start, and live modules follow their session times instead.">
          <Field label="Unlock rule" htmlFor="progression" hint="A: all open. B: each module at a set date and time, or hours after the start (set per module). C: once the previous video is watched to a percentage. D: with its secret link (?k=…) from an email, remembered per browser.">
            <Select name="progression" value={funnel.progression} options={PROGRESSIONS.map((value, index) => [value, `${"ABCD"[index]} · ${PROGRESSION_LABELS[value]}`])} />
          </Field>
          <Check advanced name="lockFirstModule" label="Lock the first module too (set times and link keys)" defaultChecked={funnel.lockFirstModule} hint="Normally the first module opens when the funnel starts. Ticked, it follows the same rule as the others. Best with the Microsite type, so visitors land on the home page." />
          <Check advanced name="keyForceUnlock" label="Email links can force-unlock a module early (B and C)" defaultChecked={funnel.keyForceUnlock} hint="Each module gets a secret link (?k=…) for your emails. Opening it unlocks that module straight away, even before its time or watch percentage, and the browser remembers it. Without the link, the module still unlocks on its own rule." />
          <Check name="lockPassedModules" label="Lock each module again once the next one unlocks (B, C and D)" defaultChecked={funnel.lockPassedModules} hint="Viewers only ever have the newest module. When a later module's video opens for them, the earlier ones lock and show the “Module has passed” message with a button to the open one. The front door goes to the open one too. Live modules are never locked this way." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Each module stays open for (hours)" htmlFor="accessHours" hint="Docuseries access window: after a module opens for a viewer it expires this many hours later (e.g. 24) and shows the “Access expired” message. Blank = modules never expire. Works with A and B; live modules never expire.">
              <Input id="accessHours" name="accessHours" type="number" min={1} max={24 * 365} defaultValue={funnel.accessHours ?? ""} placeholder="Never expire" />
            </Field>
          </div>
          <Check advanced name="hidePassedModules" label="Hide passed modules from the navigation" defaultChecked={funnel.hidePassedModules} hint="Only with the option above. Ticked, a module that has locked again disappears from the module tiles instead of showing a lock. The agenda still lists it." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Percent of the previous video to watch" htmlFor="watchPercent" hint="Unlock by watching. Text modules count as read after 5 seconds open.">
              <Input id="watchPercent" name="watchPercent" type="number" min={1} max={100} defaultValue={funnel.watchPercent} />
            </Field>
            <Field label="Countdown before a module is released" htmlFor="unlockCountdownMode" hint="For modules with a release time (live sessions use their own countdown). Whatever you pick, an open page refreshes itself the moment its module unlocks.">
              <Select name="unlockCountdownMode" value={funnel.unlockCountdownMode} options={[["day_of", "On the release day only"], ["always", "Always (days, hours, minutes, seconds)"], ["off", "Off"]]} />
            </Field>
            <Field label="Countdown title" htmlFor="unlockCountdownTitle">
              <Input id="unlockCountdownTitle" name="unlockCountdownTitle" defaultValue={funnel.unlockCountdownTitle} maxLength={200} />
            </Field>
          </div>
        </Section>
        <Section advanced title="Video setup">
          <Field label="Build" htmlFor="buildMode" hint="Pre-add all: every module needs its video before the funnel can publish.">
            <Select name="buildMode" value={funnel.buildMode} options={[["as_you_go", "Build as you go (modules without a video say “coming soon”)"], ["prebuilt", "Pre-add all videos"]]} />
          </Field>
        </Section>
        <Section title="Locked-module messages" description="Tokens: {day} {prev_day} {next_day} {percent} {unlock_date}. Each module can override its message.">
          <Field label="Locked title" htmlFor="lockedTitle">
            <Input id="lockedTitle" name="lockedTitle" defaultValue={funnel.lockedTitle} maxLength={120} />
          </Field>
          {(
            [
              ["lockedScheduledMsg", "Timed unlock / not started yet", funnel.lockedScheduledMsg],
              ["lockedWatchMsg", "Unlock by watching", funnel.lockedWatchMsg],
              ["lockedKeyMsg", "Unlock by link key", funnel.lockedKeyMsg],
              ["lockedLiveMsg", "Live session not started yet", funnel.lockedLiveMsg],
              ["lockedPassedMsg", "Module has passed (a later one is open)", funnel.lockedPassedMsg],
              ["lockedExpiredMsg", "Access expired (the module's access window is over)", funnel.lockedExpiredMsg],
            ] as const
          ).map(([name, label, value]) => (
            <Field key={name} label={label} htmlFor={name}>
              <Textarea id={name} name={name} defaultValue={value} className="min-h-16" maxLength={1000} />
            </Field>
          ))}
        </Section>
        <Section advanced title="Other page messages">
          <div className="grid gap-4 sm:grid-cols-2">
            {messages.map(([name, label, value]) => (
              <Field key={name} label={label} htmlFor={name}>
                <Input id={name} name={name} defaultValue={value} maxLength={300} />
              </Field>
            ))}
          </div>
        </Section>
        <Save canWrite={canWrite} />
      </fieldset>
    </form>
  );
}

/** Agenda title, layout and colours (waitlist, module agenda boxes). */
export function AgendaSettings({ funnel, canWrite, returnTab }: { funnel: FunnelRow; canWrite: boolean; returnTab: string }) {
  return (
    <form action={saveFunnel}>
      <Hidden funnel={funnel} section="agenda" />
      <input type="hidden" name="returnTab" value={returnTab} />
      <fieldset disabled={!canWrite}>
        <Section title={funnel.siteType === "microsite" ? "Agenda" : "Agenda (below the countdown)"} description="Built from each module's title, date and topics (Modules tab). To also show it under a module's video, turn it on per module.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agenda title" htmlFor="agendaTitle">
              <Input id="agendaTitle" name="agendaTitle" defaultValue={funnel.agendaTitle} maxLength={200} />
            </Field>
            <Field label="Layout" htmlFor="agendaLayout">
              <Select name="agendaLayout" value={funnel.agendaLayout} options={[["list", "List: date column, title, topics"], ["cards", "Cards: thumbnail, label · date, title, topics"]]} />
            </Field>
            <ColorText name="agendaBg" label="Agenda background" value={funnel.agendaBg} hint="Blank = the page background." />
            <ColorText name="agendaText" label="Agenda text" value={funnel.agendaText} hint="Blank = the page text colour." />
          </div>
          <Save canWrite={canWrite} />
        </Section>
      </fieldset>
    </form>
  );
}

/** The waitlist page (shown before a launch funnel starts). */
export function LandingTab({
  funnel,
  canWrite,
  local,
  timeZone,
  forms,
  smsForms,
}: {
  funnel: FunnelRow;
  canWrite: boolean;
  local: Local;
  timeZone: string;
  forms: { slug: string; title: string }[];
  smsForms: { id: string; name: string }[];
}) {
  const perViewer = funnel.mode !== "live" && funnel.timing === "per_viewer";
  void local;
  return (
    <div className="space-y-4">
      {perViewer ? <Note tone="warn">This funnel uses per-viewer timing: it starts on each visitor's first visit, so it never shows a waitlist.</Note> : null}
      <form action={saveFunnel} className="space-y-4">
        <Hidden funnel={funnel} section="waitlist" />
        <fieldset disabled={!canWrite} className="space-y-4">
          <Section title="Waitlist page" description={`Shown at the funnel's link before it starts: a big countdown to ${funnel.startAt ? formatZoned(funnel.startAt, timeZone) : "the start time (not set yet)"}, then the agenda.`}>
            <Check name="waitlistEnabled" label="Show the waitlist (countdown) page before the funnel starts" defaultChecked={funnel.waitlistEnabled} hint={`At zero it moves on by itself: ${funnel.mode === "live" ? "to the livestream room while live, otherwise the latest replay" : "to the first module"}. Off: early visitors land on the first module, locked.`} />
            <Field label="Headline" htmlFor="waitlistHeadline">
              <Input id="waitlistHeadline" name="waitlistHeadline" defaultValue={funnel.waitlistHeadline} maxLength={300} />
            </Field>
            <Field label="Subheadline" htmlFor="waitlistSubheadline">
              <Textarea id="waitlistSubheadline" name="waitlistSubheadline" defaultValue={funnel.waitlistSubheadline} maxLength={1000} className="min-h-16" />
            </Field>
            <Field label="Background image" htmlFor="waitlistBgImageUrl" hint="Optional https link, darkened behind the countdown.">
              <Input id="waitlistBgImageUrl" name="waitlistBgImageUrl" type="url" defaultValue={funnel.waitlistBgImageUrl ?? ""} placeholder="https://" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorText name="waitlistBg" label="Background" value={funnel.waitlistBg} hint="Blank = the header colours (Design)." />
              <ColorText name="waitlistText" label="Text" value={funnel.waitlistText} />
              <ColorText name="countdownBoxBg" label="Countdown boxes" value={funnel.countdownBoxBg} hint="#rrggbb" />
              <ColorText name="countdownDigit" label="Countdown digits" value={funnel.countdownDigit} hint="#rrggbb" />
            </div>
          </Section>
          <Section title="Pre-event homework" description="Right below the Add to calendar / join early button. Link clicks are counted in Stats.">
            <Check name="homeworkEnabled" label="Show a pre-event homework section" defaultChecked={funnel.homeworkEnabled} />
            <Field label="Heading" htmlFor="homeworkTitle">
              <Input id="homeworkTitle" name="homeworkTitle" defaultValue={funnel.homeworkTitle} maxLength={200} />
            </Field>
            <Field label="Subheading" htmlFor="homeworkSubtitle" hint="Optional.">
              <Textarea id="homeworkSubtitle" name="homeworkSubtitle" defaultValue={funnel.homeworkSubtitle} maxLength={1000} className="min-h-16" />
            </Field>
            <LinkRows prefix="hw" items={linkItems(funnel.homeworkItems)} label="Homework links" />
          </Section>
          <Section title="Opt-in" description="Optional. Reuse one of this brand's published forms, collect just an email address, or an SMS form.">
            <Field label="Opt-in on the waitlist" htmlFor="optinMode">
              <select id="optinMode" name="optinMode" defaultValue={funnel.optinMode} className="pc-control w-full text-sm">
                <option value="none">None</option>
                <option value="email">Simple email capture</option>
                <option value="form" disabled={forms.length === 0}>
                  A published form{forms.length === 0 ? " (none published yet)" : ""}
                </option>
                <option value="sms" disabled={smsForms.length === 0}>
                  An SMS opt-in form{smsForms.length === 0 ? " (add one on the SMS forms tab)" : ""}
                </option>
              </select>
            </Field>
            {smsForms.length ? (
              <Field label="SMS form" htmlFor="optinSmsFormId">
                <Select name="optinSmsFormId" value={funnel.optinSmsFormId ?? ""} options={[["", "Pick an SMS form"], ...smsForms.map((form) => [form.id, form.name] as [string, string])]} />
              </Field>
            ) : null}
            {forms.length ? (
              <Field label="Form" htmlFor="optinFormSlug" hint="Embedded from Forms; responses are stored there.">
                <Select name="optinFormSlug" value={funnel.optinFormSlug ?? ""} options={[["", "Pick a form"], ...forms.map((form) => [form.slug, form.title] as [string, string])]} />
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
          <Save canWrite={canWrite}>Save waitlist</Save>
        </fieldset>
      </form>
      <AgendaSettings funnel={funnel} canWrite={canWrite} returnTab="waitlist" />
    </div>
  );
}

/** Close page content (the behaviour itself is under Mode & schedule). */
export function CloseTab({ funnel, canWrite }: { funnel: FunnelRow; canWrite: boolean }) {
  return (
    <form action={saveFunnel} className="space-y-4">
      <Hidden funnel={funnel} section="close" />
      <fieldset disabled={!canWrite} className="space-y-4">
        <Section title="Close page" description="What visitors see once the funnel closes. The footer is under Design.">
          {funnel.closeMode !== "page" ? <Note>The close behaviour is “{funnel.closeMode === "redirect" ? "redirect" : "never close"}” (Mode & schedule), so this page isn't shown.</Note> : null}
          <Field label="Headline" htmlFor="closeHeadline">
            <Input id="closeHeadline" name="closeHeadline" defaultValue={funnel.closeHeadline} maxLength={300} />
          </Field>
          <Field label="Message" htmlFor="closeMessageHtml">
            <RichTextArea funnelId={funnel.id} id="closeMessageHtml" name="closeMessageHtml" defaultValue={funnel.closeMessageHtml} rows={5} disabled={!canWrite} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" htmlFor="closeButtonText" hint="Optional, e.g. the order page.">
              <Input id="closeButtonText" name="closeButtonText" defaultValue={funnel.closeButtonText ?? ""} maxLength={120} />
            </Field>
            <Field label="Button link" htmlFor="closeButtonUrl">
              <Input id="closeButtonUrl" name="closeButtonUrl" type="url" defaultValue={funnel.closeButtonUrl ?? ""} placeholder="https://" />
            </Field>
          </div>
        </Section>
        <Save canWrite={canWrite} />
      </fieldset>
    </form>
  );
}

/** Modules: the list on the left, the selected module's editor on the right, then the calendar-buttons embed. */
export function ModulesTab({ funnel, days, selectedId, smsForms, canWrite, local, zone, links, timeZone }: { funnel: FunnelRow; days: DayRow[]; selectedId?: string; smsForms: { id: string; name: string }[]; canWrite: boolean; local: Local; zone: string; links: FunnelLinks; timeZone: string }) {
  const selected = days.find((day) => day.id === selectedId) ?? days[0];
  const live = funnel.mode === "live";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          <ol className="space-y-2">
            {days.map((day) => {
              const thumb = dayThumb(day, `/l/${funnel.slug}`, true);
              const text = isTextModule(day, funnel.mode);
              const video = dayVideo(day);
              const status = text ? (hasBody(day.bodyHtml) ? "📝 text module" : "📝 text, empty") : video ? `🎬 ${PROVIDER_LABELS[video.provider]} video` : live && day.isLive ? "replay not added yet" : "no video yet";
              return (
                <li key={day.id}>
                  <Link href={`/funnels/${funnel.id}?tab=days&day=${day.id}`} aria-current={day.id === selected?.id ? "page" : undefined} className={`flex items-center gap-3 rounded-lg border p-2 ${day.id === selected?.id ? "border-accent bg-[#eef2ff]" : "border-line bg-white hover:bg-canvas"}`}>
                    <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-[#1f2937] text-sm font-bold text-white">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : day.position}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {dayLabel(day)}
                        {live && day.isLive ? <span className="ml-1.5 rounded bg-[#fee4e2] px-1.5 py-0.5 text-[10px] font-bold text-[#b42318]">LIVE</span> : null}
                      </span>
                      <span className="block truncate text-xs text-muted">{day.title || "Untitled"}</span>
                      <span className="block truncate text-xs text-muted">{status}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {canWrite ? (
            <form action={addDay}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <Button type="submit" variant="secondary" className="w-full">
                + Add module
              </Button>
            </form>
          ) : null}
        </div>
        {selected ? <ModuleEditor funnel={funnel} day={selected} days={days} smsForms={smsForms} canWrite={canWrite} local={local} zone={zone} links={links} timeZone={timeZone} /> : <Section title="No modules yet">Add the first module.</Section>}
      </div>
      <form action={saveFunnel}>
        <Hidden funnel={funnel} section="livendar" />
        <fieldset disabled={!canWrite}>
          <Section title="Calendar buttons under the video" description="Paste the “Add to calendar” button code from your calendar tool (for example Livendar). It shows under the video on every module; each module can use its own code or hide it. Scripts are removed; the buttons and their styling stay, and clicks count as calendar clicks.">
            <Field label="Heading above the buttons" htmlFor="livendarTitle" hint="Blank = no heading.">
              <Input id="livendarTitle" name="livendarTitle" defaultValue={funnel.livendarTitle} maxLength={200} />
            </Field>
            <EmbedBox name="livendarHtml" value={funnel.livendarHtml} />
            <Save canWrite={canWrite} />
          </Section>
        </fieldset>
      </form>
      <p className="text-sm text-muted">Custom pages, links and placeholder tiles are on the Pages &amp; links tab.</p>
    </div>
  );
}

function EmbedBox({ name, value }: { name: string; value: string }) {
  return (
    <>
      <Field label="Embed code" htmlFor={name} hint="Paste the full code.">
        <Textarea id={name} name={name} defaultValue={value} className="min-h-28 font-mono text-xs" spellCheck={false} />
      </Field>
      {value.trim() ? (
        <Field label="Preview" htmlFor={`${name}-preview`} hint="Links are disabled here.">
          <iframe id={`${name}-preview`} title="Calendar buttons preview" sandbox="" srcDoc={value} className="h-24 w-full rounded-md border border-line bg-white" />
        </Field>
      ) : null}
    </>
  );
}

function ModuleEditor({ funnel, day, days, smsForms, canWrite, local, zone, links, timeZone }: { funnel: FunnelRow; day: DayRow; days: DayRow[]; smsForms: { id: string; name: string }[]; canWrite: boolean; local: Local; zone: string; links: FunnelLinks; timeZone: string }) {
  const index = days.findIndex((item) => item.id === day.id);
  const live = funnel.mode === "live";
  const liveDay = live && day.isLive;
  const text = isTextModule(day, funnel.mode);
  const video = dayVideo(day);
  const perViewer = !live && funnel.timing === "per_viewer";
  const followsProgression = (index > 0 || funnel.lockFirstModule) && !liveDay && funnel.progression !== "all_open";
  const unlockBy = day.unlockAt ? "time" : "offset";
  const offsetDate = !perViewer ? scheduledUnlock({ unlockAt: null, unlockOffsetHours: day.unlockOffsetHours }, funnel.startAt) : null;
  const keyOpens = keyUnlocks(funnel);
  const keyLink = links.at(`/day-${day.position}`, { k: day.unlockKey });
  const thumb = dayThumb(day, `/l/${funnel.slug}`, true);
  const resources = linkItems(day.resources);
  const preview = links.preview(`/day-${day.position}`);
  return (
    <div className="min-w-0 space-y-4">
      <form action={saveDay} encType="multipart/form-data" className="space-y-4" id={`day-${day.id}`}>
        <input type="hidden" name="funnelId" value={funnel.id} />
        <input type="hidden" name="dayId" value={day.id} />
        <fieldset disabled={!canWrite} className="space-y-4">
          <Section title={dayLabel(day)}>
            <div className="flex flex-wrap gap-2">
              <a href={preview} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
                Preview this module
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Page title" htmlFor="title">
                <Input id="title" name="title" defaultValue={day.title} maxLength={300} />
              </Field>
              <Field label="Nav label" htmlFor="navLabel" hint={`Default “Day ${day.position}”.`}>
                <Input id="navLabel" name="navLabel" defaultValue={day.navLabel ?? ""} maxLength={60} />
              </Field>
            </div>
            <Field label="Short description" htmlFor="summary" hint="One or two sentences. Shown on the Episode grid cards (offer section).">
              <Textarea id="summary" name="summary" defaultValue={day.summary} maxLength={400} className="min-h-16" />
            </Field>
            <Field label="Topics" htmlFor="topics" hint="One per line. Shown in the agenda (a single line is the description in the cards layout).">
              <Textarea id="topics" name="topics" defaultValue={day.topics.join("\n")} className="min-h-20" />
            </Field>
          </Section>

          {live ? (
            <Section title="Live session">
              <Check name="isLive" label="This module is a livestream" defaultChecked={day.isLive} hint="While live, the page says “We're live” and sends visitors to the room. Add the replay below afterwards." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Live starts (${zone})`} htmlFor="liveStartAt">
                  <Input id="liveStartAt" name="liveStartAt" type="datetime-local" defaultValue={local(day.liveStartAt)} />
                </Field>
                <Field label={`Live ends (${zone})`} htmlFor="liveEndAt" hint="Blank = 3 hours.">
                  <Input id="liveEndAt" name="liveEndAt" type="datetime-local" defaultValue={local(day.liveEndAt)} />
                </Field>
                <Field label="Livestream room" htmlFor="liveUrl" hint={funnel.livestreamUrl ? "Blank = the funnel's room." : "Required (the funnel has no default room)."}>
                  <Input id="liveUrl" name="liveUrl" type="url" defaultValue={day.liveUrl ?? ""} placeholder="https://" />
                </Field>
                <Field label="Live switch" htmlFor="liveOverride">
                  <Select name="liveOverride" value={day.liveOverride} options={[["auto", "Automatic: live between the start and end"], ["on", "Force LIVE now (send everyone to the room)"], ["off", "Force NOT live (ended early or cancelled)"]]} />
                </Field>
                {funnel.calendarEnabled && funnel.calendarMode === "url" ? (
                  <Field label="Add to calendar link for this session" htmlFor="calendarUrl" hint={funnel.calendarUrl ? "Blank = the funnel's link." : "Needed for this session's button (the funnel has no link)."} className="sm:col-span-2">
                    <Input id="calendarUrl" name="calendarUrl" type="url" defaultValue={day.calendarUrl ?? ""} placeholder="https://" />
                  </Field>
                ) : (
                  <input type="hidden" name="calendarUrl" value={day.calendarUrl ?? ""} />
                )}
              </div>
            </Section>
          ) : (
            <>
              <input type="hidden" name="isLive" value={day.isLive ? "on" : ""} />
              <input type="hidden" name="liveStartAt" value={local(day.liveStartAt)} />
              <input type="hidden" name="liveEndAt" value={local(day.liveEndAt)} />
              <input type="hidden" name="liveUrl" value={day.liveUrl ?? ""} />
              <input type="hidden" name="liveOverride" value={day.liveOverride} />
              <input type="hidden" name="calendarUrl" value={day.calendarUrl ?? ""} />
            </>
          )}

          {liveDay ? (
            <Section title="Text below the video box" description="Live modules always keep the video box (countdown, live redirect, replay). Anything here shows underneath. Optional.">
              <input type="hidden" name="kind" value={day.kind} />
              <RichTextArea funnelId={funnel.id} id="bodyHtml" name="bodyHtml" defaultValue={day.bodyHtml} rows={5} disabled={!canWrite} />
            </Section>
          ) : (
            <Section title="Module type">
              <Field label="Type" htmlFor="kind" hint="Text: a written module (rich text, images, links) in place of the video box. Same unlock rules.">
                <Select name="kind" value={day.kind} options={[["video", "🎬 Video"], ["text", "📝 Text"]]} />
              </Field>
              <Field label={text ? "Content" : "Notes under the video (optional)"} htmlFor="bodyHtml">
                <RichTextArea funnelId={funnel.id} id="bodyHtml" name="bodyHtml" defaultValue={day.bodyHtml} rows={text ? 10 : 4} disabled={!canWrite} />
              </Field>
            </Section>
          )}

          <Section title={liveDay ? "Replay video" : text ? "Navigation thumbnail" : "Video"}>
            {!text ? (
              <>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <Field label="Video link, embed code or id" htmlFor="video" hint="Wistia (default), YouTube or Vidalytics. Paste a link, the embed code, or the id. Title, length and thumbnail fill in when the provider shares them.">
                    <Textarea id="video" name="video" defaultValue={video ? watchUrl(video) : ""} className="min-h-16 font-mono text-xs" placeholder="https://…wistia.com/medias/… · https://youtu.be/… · Vidalytics embed code" spellCheck={false} />
                  </Field>
                  <Field label="Provider" htmlFor="videoProvider" hint="Auto works it out from the link.">
                    <Select name="videoProvider" value="" options={[["", "Auto"], ["wistia", "Wistia"], ["youtube", "YouTube"], ["vidalytics", "Vidalytics"]]} />
                  </Field>
                </div>
                {video ? (
                  <p className="text-sm">
                    🎬 <b>{day.videoTitle || video.id}</b> · {PROVIDER_LABELS[video.provider]}
                    {day.videoDuration ? ` · ${formatDuration(day.videoDuration)}` : ""}
                    {video.provider !== "vidalytics" ? (
                      <>
                        {" "}
                        ·{" "}
                        <a className="text-accent underline" href={watchUrl(video)} target="_blank" rel="noopener">
                          Open
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm text-muted">{funnel.buildMode === "prebuilt" ? "Required before publishing." : `Until a video is added, this module shows “${funnel.comingSoonTitle}”.`}</p>
                )}
                {video ? <p className="text-xs text-muted">{PROGRESS_SOURCE[video.provider]}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Video title" htmlFor="videoTitle" hint="Vidalytics only (Wistia and YouTube fill it in).">
                    <Input id="videoTitle" name="videoTitle" defaultValue={video?.provider === "vidalytics" ? day.videoTitle ?? "" : ""} maxLength={200} disabled={Boolean(video && video.provider !== "vidalytics")} />
                  </Field>
                  <Field label="Length (mm:ss)" htmlFor="videoDuration" hint="Vidalytics, or when the provider didn't share it. Used for the time-on-page fallback.">
                    <Input id="videoDuration" name="videoDuration" defaultValue={formatDuration(day.videoDuration)} maxLength={10} placeholder="12:34" />
                  </Field>
                </div>
              </>
            ) : (
              <input type="hidden" name="video" value={video ? watchUrl(video) : ""} />
            )}
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded bg-[#1f2937] text-xs text-white">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : text ? "📝" : "No thumbnail"}</span>
              <p className="min-w-0 flex-1 text-sm text-muted">{day.thumbAssetId || day.thumbUrl ? "Using your thumbnail." : text ? "Text modules show a 📝 tile unless you set one." : day.videoThumbUrl ? "Automatic, from the video." : video ? "Comes from the video when the provider shares one; otherwise set one here." : "Comes from the video."}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Thumbnail upload" htmlFor="thumb" hint="Overrides the automatic one.">
                <input id="thumb" name="thumb" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
              </Field>
              <Field label="…or thumbnail link" htmlFor="thumbUrl">
                <Input id="thumbUrl" name="thumbUrl" type="url" defaultValue={day.thumbUrl ?? ""} placeholder="https://" />
              </Field>
            </div>
            {day.thumbAssetId ? <Check name="removeThumb" label="Remove the uploaded thumbnail" defaultChecked={false} /> : null}
          </Section>

          {followsProgression || (funnel.progression !== "all_open" && !liveDay) ? (
            <Section title="Unlocking">
              {!followsProgression ? <p className="text-sm text-muted">The first module opens when the funnel starts. To lock it too, tick “Lock the first module too” on Progression &amp; messages.</p> : null}
              {followsProgression && funnel.progression === "scheduled" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Unlocks" htmlFor="unlockBy">
                    <Select name="unlockBy" value={unlockBy} options={[["time", `At a set date and time (${zone})`], ["offset", "A number of hours after the start"]]} />
                  </Field>
                  <Field label={`Unlocks at (${zone})`} htmlFor="unlockAt" hint={perViewer ? "The same moment for every visitor." : "Used when “at a set date and time”."}>
                    <Input id="unlockAt" name="unlockAt" type="datetime-local" defaultValue={local(day.unlockAt)} />
                  </Field>
                  <Field label="Unlocks after (hours)" htmlFor="unlockOffsetHours" hint={perViewer ? `From each visitor's first visit.` : offsetDate ? `→ ${formatZoned(offsetDate, timeZone)}` : "Set the funnel start to see the date."}>
                    <Input id="unlockOffsetHours" name="unlockOffsetHours" type="number" min={0} defaultValue={day.unlockOffsetHours} />
                  </Field>
                </div>
              ) : (
                <>
                  <input type="hidden" name="unlockOffsetHours" value={day.unlockOffsetHours} />
                  <input type="hidden" name="unlockAt" value={local(day.unlockAt)} />
                </>
              )}
              {followsProgression && funnel.progression === "watch_percent" && index > 0 ? <p className="text-sm">Unlocks when {dayLabel(days[index - 1]!)} is watched {funnel.watchPercent}%.</p> : null}
              {followsProgression && keyOpens ? (
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <LinkBox label={funnel.progression === "url_key" ? "Unlock link (put it in this module's email)" : "Force-unlock link (opens it early; put it in this module's email)"} value={keyLink} />
                  <Field label="Link key" htmlFor="unlockKey">
                    <Input id="unlockKey" name="unlockKey" defaultValue={day.unlockKey} maxLength={40} />
                  </Field>
                </div>
              ) : (
                <input type="hidden" name="unlockKey" value={day.unlockKey} />
              )}
              {followsProgression ? (
                <Field label="Custom locked message" htmlFor="lockedMessage" hint="Blank = the funnel's message.">
                  <Textarea id="lockedMessage" name="lockedMessage" defaultValue={day.lockedMessage ?? ""} maxLength={1000} className="min-h-16" />
                </Field>
              ) : (
                <input type="hidden" name="lockedMessage" value={day.lockedMessage ?? ""} />
              )}
            </Section>
          ) : (
            <>
              <input type="hidden" name="unlockOffsetHours" value={day.unlockOffsetHours} />
              <input type="hidden" name="unlockAt" value={local(day.unlockAt)} />
              <input type="hidden" name="unlockKey" value={day.unlockKey} />
              <input type="hidden" name="lockedMessage" value={day.lockedMessage ?? ""} />
            </>
          )}

          <Section title="Docuseries">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Open for (hours)" htmlFor="dayAccessHours" hint={funnel.accessHours ? `Blank = the funnel's ${funnel.accessHours} hours.` : "Blank = never expires (set a window for every module on Progression & messages)."}>
                <Input id="dayAccessHours" name="accessHours" type="number" min={1} max={24 * 365} defaultValue={day.accessHours ?? ""} />
              </Field>
            </div>
            <Check name="showOffer" label="Show the offer section under this module" defaultChecked={day.showOffer} hint="The blocks on the Offer section tab (pricing, testimonials, FAQ…), anchored at #offer." />
          </Section>

          <Section title="Agenda">
            <Check name="showAgenda" label="Show the agenda below the video" defaultChecked={day.showAgenda} hint="In every state, including before this module unlocks. Uses the agenda title and colours from the Waitlist page tab." />
            <Field label="Show" htmlFor="agendaScope">
              <Select name="agendaScope" value={day.agendaScope} options={[["full", "Full agenda: every module (this one marked “You are here”)"], ["module", "Just this module: its date and topics"]]} />
            </Field>
          </Section>

          <Section title="Call-to-action button">
            <Field label="Show the button" htmlFor="ctaReveal">
              <Select name="ctaReveal" value={day.ctaReveal} options={[["none", "No button"], ["always", "Always visible"], ...(text ? [] : ([["video_time", "At a point in the video"]] as [string, string][])), ["datetime", "At a date and time (e.g. cart open)"]]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Appears at video time (mm:ss)" htmlFor="ctaSeconds">
                <Input id="ctaSeconds" name="ctaSeconds" defaultValue={formatDuration(day.ctaSeconds) || "0:00"} maxLength={10} />
              </Field>
              <Field label={`Appears at (${zone})`} htmlFor="ctaAt">
                <Input id="ctaAt" name="ctaAt" type="datetime-local" defaultValue={local(day.ctaAt)} />
              </Field>
              <Field label="Button text" htmlFor="ctaText">
                <Input id="ctaText" name="ctaText" defaultValue={day.ctaText} maxLength={200} />
              </Field>
              <Field label="Button link" htmlFor="ctaUrl">
                <Input id="ctaUrl" name="ctaUrl" type="url" defaultValue={day.ctaUrl} placeholder="https://" />
              </Field>
              <Field label="Small text under the button" htmlFor="ctaSubtext" className="sm:col-span-2">
                <Input id="ctaSubtext" name="ctaSubtext" defaultValue={day.ctaSubtext} maxLength={500} />
              </Field>
              <ColorText name="ctaBg" label="Button colour" value={day.ctaBg} hint="Blank = the accent colour." />
              <ColorText name="ctaTextColor" label="Button text colour" value={day.ctaTextColor} />
            </div>
            <Check name="ctaNewTab" label="Open in a new tab" defaultChecked={day.ctaNewTab} />
          </Section>

          <Section title="SMS signup form under the video">
            {smsForms.length ? (
              <Field label="Form" htmlFor="smsFormId">
                <Select name="smsFormId" value={day.smsFormId ?? ""} options={[["", "None"], ...smsForms.map((form) => [form.id, form.name] as [string, string])]} />
              </Field>
            ) : (
              <>
                <input type="hidden" name="smsFormId" value={day.smsFormId ?? ""} />
                <p className="text-sm text-muted">Build forms on the SMS forms tab.</p>
              </>
            )}
          </Section>

          <Section title="Calendar buttons under the video">
            <Field label="Under this module's video" htmlFor="livendarMode">
              <Select name="livendarMode" value={day.livendarMode} options={[["default", funnel.livendarHtml.trim() ? "Use the funnel's code" : "Use the funnel's code (none yet: see below the modules)"], ["custom", "Use different code for this module"], ["off", "Don't show calendar buttons"]]} />
            </Field>
            <EmbedBox name="livendarHtml" value={day.livendarHtml} />
          </Section>

          <Section title="Resources under the video">
            <Field label="Heading" htmlFor="resourcesHeading" hint="Optional.">
              <Input id="resourcesHeading" name="resourcesHeading" defaultValue={day.resourcesHeading} maxLength={300} />
            </Field>
            <LinkRows prefix="res" items={resources} label="Resources" />
          </Section>
          <Save canWrite={canWrite}>Save {dayLabel(day)}</Save>
        </fieldset>
      </form>
      {canWrite ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-line bg-white p-4">
          <form action={moveDay}>
            <input type="hidden" name="funnelId" value={funnel.id} />
            <input type="hidden" name="dayId" value={day.id} />
            <Button type="submit" name="direction" value="up" variant="secondary" size="sm" disabled={index === 0}>
              ↑ Move up
            </Button>
          </form>
          <form action={moveDay}>
            <input type="hidden" name="funnelId" value={funnel.id} />
            <input type="hidden" name="dayId" value={day.id} />
            <Button type="submit" name="direction" value="down" variant="secondary" size="sm" disabled={index === days.length - 1}>
              ↓ Move down
            </Button>
          </form>
          <form action={setAgendaOnAllDays}>
            <input type="hidden" name="funnelId" value={funnel.id} />
            <Button type="submit" name="on" value="1" variant="secondary" size="sm">
              Agenda on for all modules
            </Button>
          </form>
          <form action={setAgendaOnAllDays}>
            <input type="hidden" name="funnelId" value={funnel.id} />
            <Button type="submit" name="on" value="0" variant="secondary" size="sm">
              Agenda off for all
            </Button>
          </form>
          {days.length > 1 ? (
            <form action={deleteDay}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <input type="hidden" name="dayId" value={day.id} />
              <Button type="submit" variant="danger" size="sm">
                Remove module
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
