import { Button, Input, Textarea } from "@pubcommand/ui";
import { normalizeBlocks } from "../../../../../modules/funnels/blocks";
import { safeColor } from "../../../../../modules/funnels/checks";
import type { FunnelLinks } from "./guard";
import { DEADLINE_PAGES, DEADLINE_PAGE_LABELS, normalizeDeadlinePages } from "../../../../../modules/funnels/deadline";
import { navSequence } from "../../../../../modules/funnels/nav";
import { utcToZonedLocal } from "../../../../../modules/funnels/time";
import { copyDesignFrom, addHost, addNavItem, deleteHost, deleteNavItem, moveHost, moveNavItem, saveHost, saveNavItem } from "./site-actions";
import { saveFunnel } from "./actions";
import { dayLabel, funnelDesign, type DayRow, type FunnelRow, type HostRow, type NavItemRow } from "./data";
import { DesignEditor, type DesignPayload } from "./design-editor";
import { Check, ColorField, Field, Section } from "./fields";
import { HomeBuilder } from "./home-builder";
import { hostPhoto } from "./home-view";
import { RichTextArea } from "./rich-text-area";
import { hasDraft as hasDraftValue, navItemThumb, parseDesignDraft, parseHomeDraft, parseOfferDraft } from "./site-data";

type Option = { value: string; label: string };

function Hidden({ funnel, section }: { funnel: FunnelRow; section?: string }) {
  return (
    <>
      <input type="hidden" name="funnelId" value={funnel.id} />
      {section ? <input type="hidden" name="section" value={section} /> : null}
    </>
  );
}

function MoveDelete({ funnel, idName, id, first, last, move, remove, removeLabel }: { funnel: FunnelRow; idName: string; id: string; first: boolean; last: boolean; move: (formData: FormData) => Promise<void>; remove: (formData: FormData) => Promise<void>; removeLabel: string }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
      {!first ? (
        <form action={move}>
          <Hidden funnel={funnel} />
          <input type="hidden" name={idName} value={id} />
          <Button type="submit" name="direction" value="up" variant="secondary" size="sm">
            ↑ Move up
          </Button>
        </form>
      ) : null}
      {!last ? (
        <form action={move}>
          <Hidden funnel={funnel} />
          <input type="hidden" name={idName} value={id} />
          <Button type="submit" name="direction" value="down" variant="secondary" size="sm">
            ↓ Move down
          </Button>
        </form>
      ) : null}
      <form action={remove}>
        <Hidden funnel={funnel} />
        <input type="hidden" name={idName} value={id} />
        <Button type="submit" variant="danger" size="sm">
          {removeLabel}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The offer section under module pages: the same block builder as the home page, saved to offerBlocks. */
export function OfferTab({ funnel, days, navItems, hosts, forms, smsForms = [], timeZone, zone, canWrite }: { funnel: FunnelRow; days: DayRow[]; navItems: NavItemRow[]; hosts: HostRow[]; forms: { slug: string; title: string }[]; smsForms?: { id: string; name: string }[]; timeZone: string; zone: string; canWrite: boolean }) {
  const hasDraft = hasDraftValue(funnel.offerBlocksDraft);
  const blocks = hasDraft ? parseOfferDraft(funnel.offerBlocksDraft, funnel).blocks : normalizeBlocks(funnel.offerBlocks);
  const first = [...days].sort((a, b) => a.position - b.position)[0];
  return (
    <HomeBuilder
      target="offer"
      funnelId={funnel.id}
      publicPath={`/l/${funnel.slug}/day-${first?.position ?? 1}`}
      timeZone={timeZone}
      zone={zone}
      initial={{ blocks, shell: funnel.homeShell, title: funnel.homeTitle }}
      forms={forms.map((form) => ({ value: form.slug, label: form.title }))}
      smsForms={smsForms.map((form) => ({ value: form.id, label: form.name }))}
      modules={days.map((day) => ({ value: String(day.position), label: `${dayLabel(day)}${day.title ? `: ${day.title}` : ""}` }))}
      pages={navItems.filter((item) => item.kind === "page").map((item) => ({ value: item.slug, label: item.title || item.label || item.slug }))}
      hostCount={hosts.length}
      canWrite={canWrite}
      hasDraft={hasDraft}
    />
  );
}

export function HomeTab({ funnel, days, navItems, hosts, forms, smsForms = [], timeZone, zone, canWrite }: { funnel: FunnelRow; days: DayRow[]; navItems: NavItemRow[]; hosts: HostRow[]; forms: { slug: string; title: string }[]; smsForms?: { id: string; name: string }[]; timeZone: string; zone: string; canWrite: boolean }) {
  const hasDraft = hasDraftValue(funnel.homeBlocksDraft);
  const state = hasDraft ? parseHomeDraft(funnel.homeBlocksDraft, funnel) : { blocks: normalizeBlocks(funnel.homeBlocks), shell: funnel.homeShell, title: funnel.homeTitle };
  const blocks = state.blocks;
  return (
    <>
      {funnel.siteType !== "microsite" ? (
        <p className="mb-4 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm text-[#93370d]">This funnel is a launch funnel, so its front door is the waitlist. Switch the type to Microsite (Mode & schedule) to use this home page.</p>
      ) : null}
      <HomeBuilder
        funnelId={funnel.id}
        publicPath={`/l/${funnel.slug}`}
        timeZone={timeZone}
        zone={zone}
        initial={{ ...state, blocks }}
        forms={forms.map((form) => ({ value: form.slug, label: form.title }))}
        smsForms={smsForms.map((form) => ({ value: form.id, label: form.name }))}
        modules={days.map((day) => ({ value: String(day.position), label: `${dayLabel(day)}${day.title ? `: ${day.title}` : ""}` }))}
        pages={navItems.filter((item) => item.kind === "page").map((item) => ({ value: item.slug, label: item.title || item.label || item.slug }))}
        hostCount={hosts.length}
        canWrite={canWrite}
        hasDraft={hasDraft}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

export function HostsTab({ funnel, hosts, openId, canWrite }: { funnel: FunnelRow; hosts: HostRow[]; openId?: string; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      <form action={saveFunnel}>
        <Hidden funnel={funnel} section="hosts" />
        <fieldset disabled={!canWrite}>
          <Section title="Hosts" description="The people presenting. They show on the waitlist (below the agenda) and in a home page “Meet your hosts” block.">
            <Check name="hostsEnabled" label="Show the hosts on the waitlist" defaultChecked={funnel.hostsEnabled} />
            <Field label="Heading" htmlFor="hostsTitle">
              <Input id="hostsTitle" name="hostsTitle" defaultValue={funnel.hostsTitle} maxLength={120} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Section background" htmlFor="hostsBg" hint="#rrggbb, or blank for the page background.">
                <Input id="hostsBg" name="hostsBg" defaultValue={funnel.hostsBg} maxLength={7} placeholder="#f3f4f6" className="font-mono" />
              </Field>
              <Field label="Heading colour" htmlFor="hostsTitleColor" hint="#rrggbb, or blank.">
                <Input id="hostsTitleColor" name="hostsTitleColor" defaultValue={funnel.hostsTitleColor} maxLength={7} placeholder="#111827" className="font-mono" />
              </Field>
            </div>
            {canWrite ? <Button type="submit">Save</Button> : null}
          </Section>
        </fieldset>
      </form>
      {hosts.map((host, index) => {
        const photo = hostPhoto(funnel, host);
        return (
          <details key={host.id} id={`host-${host.id}`} open={openId === host.id} className="rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-full bg-canvas">{photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : null}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{host.name || "Unnamed host"}</span>
                <span className="block truncate text-xs text-muted">{host.title || "No title"}</span>
              </span>
            </summary>
            <div className="border-t border-line p-4">
              <form action={saveHost} encType="multipart/form-data" className="space-y-4">
                <Hidden funnel={funnel} />
                <input type="hidden" name="hostId" value={host.id} />
                <fieldset disabled={!canWrite} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" htmlFor={`hn-${host.id}`}>
                      <Input id={`hn-${host.id}`} name="name" defaultValue={host.name} maxLength={120} />
                    </Field>
                    <Field label="Title" htmlFor={`ht-${host.id}`} hint="e.g. Founder, Editor">
                      <Input id={`ht-${host.id}`} name="title" defaultValue={host.title} maxLength={160} />
                    </Field>
                    <Field label="Photo upload" htmlFor={`hp-${host.id}`} hint="Square works best. PNG, JPG, WebP or GIF up to 3 MB.">
                      <input id={`hp-${host.id}`} name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
                    </Field>
                    <Field label="…or photo link" htmlFor={`hu-${host.id}`}>
                      <Input id={`hu-${host.id}`} name="photoUrl" type="url" defaultValue={host.photoUrl ?? ""} placeholder="https://" />
                    </Field>
                  </div>
                  {host.photoAssetId ? <Check name="removePhoto" label="Remove the uploaded photo" defaultChecked={false} /> : null}
                  <Field label="Bio" htmlFor={`hb-${host.id}`}>
                    <RichTextArea funnelId={funnel.id} id={`hb-${host.id}`} name="bioHtml" defaultValue={host.bioHtml} rows={5} />
                  </Field>
                  {canWrite ? <Button type="submit">Save host</Button> : null}
                </fieldset>
              </form>
              {canWrite ? <MoveDelete funnel={funnel} idName="hostId" id={host.id} first={index === 0} last={index === hosts.length - 1} move={moveHost} remove={deleteHost} removeLabel="Remove host" /> : null}
            </div>
          </details>
        );
      })}
      {canWrite ? (
        <form action={addHost}>
          <Hidden funnel={funnel} />
          <Button type="submit" variant="secondary">
            + Add a host
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const KIND_LABEL = { page: "Custom page", link: "Link", placeholder: "Coming soon" } as const;

export function PagesTab({ funnel, days, navItems, forms, smsForms = [], openId, canWrite, links }: { funnel: FunnelRow; days: DayRow[]; navItems: NavItemRow[]; forms: { slug: string; title: string }[]; smsForms?: { id: string; name: string }[]; openId?: string; canWrite: boolean; links: FunnelLinks }) {
  const order = navSequence(days, navItems);
  const places: Option[] = [{ value: "0", label: "Before the first module" }, ...days.map((day, index) => ({ value: String(index + 1), label: `After ${dayLabel(day)}` })), { value: "", label: "At the end" }];
  return (
    <div className="space-y-4">
      <Section title="Pages & links" description="Extra tiles in the navigation, placed among the modules: custom pages (/p/<name>), links to other sites (open in a new tab) and “coming soon” placeholders. They are never progression-locked.">
        <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Navigation order">
          {order.map((entry, index) => (
            <li key={entry.kind === "day" ? entry.day.id : entry.item.id} className={`rounded-md border px-2 py-1 ${entry.kind === "day" ? "border-line bg-canvas" : "border-accent/40 bg-[#eef2ff] text-[#1e3a8a]"} ${entry.kind === "item" && !entry.item.showInNav ? "opacity-50" : ""}`}>
              {index + 1}. {entry.kind === "day" ? dayLabel(entry.day) : `${entry.item.label || KIND_LABEL[entry.item.kind as keyof typeof KIND_LABEL] || "Item"}${entry.item.showInNav ? "" : " (hidden)"}`}
            </li>
          ))}
        </ol>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {(["page", "link", "placeholder"] as const).map((kind) => (
              <form key={kind} action={addNavItem}>
                <Hidden funnel={funnel} />
                <input type="hidden" name="kind" value={kind} />
                <Button type="submit" variant="secondary" size="sm">
                  + {kind === "page" ? "Custom page" : kind === "link" ? "Link" : "Coming-soon placeholder"}
                </Button>
              </form>
            ))}
          </div>
        ) : null}
      </Section>
      {navItems.map((item, index) => {
        const thumb = navItemThumb(funnel, item);
        const id = (name: string) => `${name}-${item.id}`;
        return (
          <details key={item.id} id={`item-${item.id}`} open={openId === item.id} className="rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <span className="block w-20 shrink-0 overflow-hidden rounded-md bg-canvas" style={{ aspectRatio: "16 / 9" }}>
                {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted">{KIND_LABEL[item.kind as keyof typeof KIND_LABEL] ?? item.kind}</span>
                <span className="block truncate font-semibold">{item.label || item.title || "Untitled"}</span>
                <span className="block truncate font-mono text-xs text-muted">{item.kind === "page" ? `/l/${funnel.slug}/p/${item.slug}` : item.kind === "link" ? item.url || "No address yet" : item.agendaWhen || "Not clickable"}</span>
              </span>
            </summary>
            <div className="border-t border-line p-4">
              <form action={saveNavItem} encType="multipart/form-data" className="space-y-4">
                <Hidden funnel={funnel} />
                <input type="hidden" name="itemId" value={item.id} />
                <fieldset disabled={!canWrite} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Navigation label" htmlFor={id("label")}>
                      <Input id={id("label")} name="label" defaultValue={item.label} maxLength={60} />
                    </Field>
                    <Field label="Position" htmlFor={id("after")}>
                      <select id={id("after")} name="afterModule" defaultValue={item.afterModule === null ? "" : String(item.afterModule)} className="pc-control w-full text-sm">
                        {places.map((place) => (
                          <option key={place.value} value={place.value}>
                            {place.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="pt-6">
                      <Check name="showInNav" label="Show in the navigation" defaultChecked={item.showInNav} hint={item.kind === "page" ? "Off: the page stays live at its address with no tile." : undefined} />
                    </div>
                  </div>

                  {item.kind === "page" ? (
                    <>
                      {funnel.siteType !== "microsite" ? <Check name="isHome" label="Use as the funnel's home page" defaultChecked={item.isHome} hint="The funnel's link shows this page instead of the waitlist or the current module (until the funnel closes). Pair it with “Show in the navigation” off for a page reached only at the front door." /> : null}
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="Page title" htmlFor={id("title")}>
                          <Input id={id("title")} name="title" defaultValue={item.title} maxLength={160} />
                        </Field>
                        <Field label="Link name" htmlFor={id("slug")} hint={`/l/${funnel.slug}/p/${item.slug}`}>
                          <Input id={id("slug")} name="slug" defaultValue={item.slug} maxLength={60} required pattern="[a-z0-9-]+" />
                        </Field>
                        <Field label="Title placement" htmlFor={id("tp")}>
                          <select id={id("tp")} name="titlePlacement" defaultValue={item.titlePlacement} className="pc-control w-full text-sm">
                            <option value="outside">Above the content box</option>
                            <option value="inside">Inside the box, at the top</option>
                            <option value="hidden">No title</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="Content" htmlFor={id("mode")}>
                        <select id={id("mode")} name="contentMode" defaultValue={item.contentMode} className="pc-control w-full text-sm">
                          <option value="rich">Rich text (in the content box)</option>
                          <option value="html">Custom HTML / embed code (runs in a sandbox)</option>
                        </select>
                      </Field>
                      <Field label="Rich text" htmlFor={id("body")} hint="Used when Content is rich text.">
                        <RichTextArea funnelId={funnel.id} id={id("body")} name="bodyHtml" defaultValue={item.bodyHtml} rows={8} />
                      </Field>
                      <Field label="Custom HTML" htmlFor={id("html")} hint="Used when Content is custom HTML. Scripts and forms run in a sandbox and cannot reach the page.">
                        <Textarea id={id("html")} name="html" defaultValue={item.html} className="min-h-32 font-mono text-[12.5px]" spellCheck={false} />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Opt-in under the page" htmlFor={id("optin")}>
                          <select id={id("optin")} name="optinMode" defaultValue={item.optinMode} className="pc-control w-full text-sm">
                            <option value="none">None</option>
                            <option value="email">Simple email capture</option>
                            <option value="form" disabled={!forms.length}>
                              A published form{forms.length ? "" : " (none yet)"}
                            </option>
                            <option value="sms" disabled={!smsForms.length}>
                              An SMS opt-in form{smsForms.length ? "" : " (add one on the SMS forms tab)"}
                            </option>
                          </select>
                        </Field>
                        {smsForms.length ? (
                          <Field label="SMS form" htmlFor={id("sms")}>
                            <select id={id("sms")} name="smsFormId" defaultValue={item.smsFormId ?? ""} className="pc-control w-full text-sm">
                              <option value="">Pick an SMS form</option>
                              {smsForms.map((form) => (
                                <option key={form.id} value={form.id}>
                                  {form.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ) : null}
                        {forms.length ? (
                          <Field label="Form" htmlFor={id("form")}>
                            <select id={id("form")} name="optinFormSlug" defaultValue={item.optinFormSlug ?? ""} className="pc-control w-full text-sm">
                              <option value="">Pick a form</option>
                              {forms.map((form) => (
                                <option key={form.slug} value={form.slug}>
                                  {form.title}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ) : null}
                      </div>
                    </>
                  ) : item.kind === "link" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Web address" htmlFor={id("url")}>
                        <Input id={id("url")} name="url" type="url" defaultValue={item.url} placeholder="https://" />
                      </Field>
                      <div className="pt-6">
                        <Check name="newTab" label="Open in a new tab" defaultChecked={item.newTab} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-muted">A tile that looks like a module but links nowhere, to tease what is coming.</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Check name="showLock" label="Show a lock icon" defaultChecked={item.showLock} />
                        <Check name="faded" label="Faded look" defaultChecked={item.faded} />
                      </div>
                      <Check name="showInAgenda" label="List it in the agenda" defaultChecked={item.showInAgenda} hint="In its position among the modules: on the waitlist, module agenda boxes and home page agenda blocks." />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Agenda title" htmlFor={id("title")} hint="Empty = the navigation label.">
                          <Input id={id("title")} name="title" defaultValue={item.title} maxLength={160} />
                        </Field>
                        <Field label="When" htmlFor={id("when")} hint="Free text, e.g. “Thursday” or “Coming soon”.">
                          <Input id={id("when")} name="agendaWhen" defaultValue={item.agendaWhen} maxLength={120} />
                        </Field>
                      </div>
                      <Field label="Description" htmlFor={id("desc")}>
                        <Textarea id={id("desc")} name="agendaDesc" defaultValue={item.agendaDesc} className="min-h-16" />
                      </Field>
                    </>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tile thumbnail upload" htmlFor={id("thumb")} hint="Optional.">
                      <input id={id("thumb")} name="thumb" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
                    </Field>
                    <Field label="…or thumbnail link" htmlFor={id("thumbUrl")}>
                      <Input id={id("thumbUrl")} name="thumbUrl" type="url" defaultValue={item.thumbUrl ?? ""} placeholder="https://" />
                    </Field>
                  </div>
                  {item.thumbAssetId ? <Check name="removeThumb" label="Remove the uploaded thumbnail" defaultChecked={false} /> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {canWrite ? <Button type="submit">Save</Button> : null}
                    {item.kind === "page" ? (
                      <a href={links.preview(`/p/${item.slug}`)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
                        Preview page
                      </a>
                    ) : null}
                  </div>
                </fieldset>
              </form>
              {canWrite ? <MoveDelete funnel={funnel} idName="itemId" id={item.id} first={index === 0} last={index === navItems.length - 1} move={moveNavItem} remove={deleteNavItem} removeLabel="Remove" /> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Countdown look, the locked video box and the episode list: everything the episode page looks like around the video. */
export function EpisodePageSettings({ funnel, canWrite }: { funnel: FunnelRow; canWrite: boolean }) {
  return (
    <form action={saveFunnel} className="space-y-4">
      <Hidden funnel={funnel} section="episode" />
      <fieldset disabled={!canWrite} className="space-y-4">
        <Section title="Countdowns" description="One look for every countdown: the waitlist, the locked video box, the header bar and countdown blocks.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Style" htmlFor="countdownStyle">
              <select id="countdownStyle" name="countdownStyle" defaultValue={funnel.countdownStyle} className="pc-control w-full text-sm">
                <option value="boxes">Boxes: one box per unit</option>
                <option value="flip">Flip clock: a tile per digit</option>
              </select>
            </Field>
            <Field label="When it reaches zero" htmlFor="countdownZero" advanced>
              <select id="countdownZero" name="countdownZero" defaultValue={funnel.countdownZero} className="pc-control w-full text-sm">
                <option value="reload">Reload into the page that just opened</option>
                <option value="stay">Stay on 00:00:00</option>
              </select>
            </Field>
            <ColorField name="countdownBoxBg" label="Box / tile colour" value={safeColor(funnel.countdownBoxBg, "#ffffff")} />
            <ColorField name="countdownDigit" label="Digit colour" value={safeColor(funnel.countdownDigit, "#111827")} />
          </div>
        </Section>
        <Section advanced title="Locked video box" description="The box in the video's place before a module opens (e.g. “Episode 2 starts in…”).">
          <Check name="lockedBoxMinimal" label="Minimal: just the headline and countdown" defaultChecked={funnel.lockedBoxMinimal} hint="Hides the lock icon and message on countdown boxes. Expired and other locked boxes keep their message." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Box colour" htmlFor="lockedBoxBg" hint="#rrggbb, or blank = default dark grey. Black: #000000.">
              <Input id="lockedBoxBg" name="lockedBoxBg" defaultValue={funnel.lockedBoxBg ?? ""} maxLength={7} className="font-mono" />
            </Field>
            <Field label="Text colour" htmlFor="lockedBoxText" hint="#rrggbb, or blank = white.">
              <Input id="lockedBoxText" name="lockedBoxText" defaultValue={funnel.lockedBoxText ?? ""} maxLength={7} className="font-mono" />
            </Field>
          </div>
        </Section>
        <Section title="Episode navigation">
          <Field label="Layout" htmlFor="navLayout">
            <select id="navLayout" name="navLayout" defaultValue={funnel.navLayout} className="pc-control w-full text-sm">
              <option value="strip">Thumbnail strip above the video</option>
              <option value="sidebar">Episode list beside the video (stacks under it on phones)</option>
            </select>
          </Field>
          <Check name="navBlurLocked" label="Blur locked and expired thumbnails" defaultChecked={funnel.navBlurLocked} />
          {canWrite ? <Button type="submit">Save episode page</Button> : null}
        </Section>
      </fieldset>
    </form>
  );
}

export function DeadlineTab({ funnel, days, timeZone, zone, canWrite }: { funnel: FunnelRow; days: DayRow[]; timeZone: string; zone: string; canWrite: boolean }) {
  const pages = normalizeDeadlinePages(funnel.deadlineBarPages);
  const pageKinds = DEADLINE_PAGES.filter((page) => (funnel.siteType === "microsite" ? page !== "waitlist" : page !== "home"));
  return (
    <div className="space-y-4">
    <EpisodePageSettings funnel={funnel} canWrite={canWrite} />
    <form action={saveFunnel} className="space-y-4">
      <Hidden funnel={funnel} section="deadline" />
      <fieldset disabled={!canWrite} className="space-y-4">
        <Section title="Deadline bar" description="A countdown ribbon across the pages you pick. It hides itself when the deadline passes, and never shows on the close page.">
          <Check name="deadlineBarEnabled" label="Show the deadline bar" defaultChecked={funnel.deadlineBarEnabled} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Counts down to" htmlFor="deadlineBarTarget" hint="The close is per viewer on per-viewer evergreen funnels.">
              <select id="deadlineBarTarget" name="deadlineBarTarget" defaultValue={funnel.deadlineBarTarget} className="pc-control w-full text-sm">
                <option value="end">When the funnel closes</option>
                <option value="start">When the funnel starts</option>
                <option value="episode">When the episode on screen expires (module pages)</option>
                <option value="custom">A set time</option>
              </select>
            </Field>
            <Field label={`Set time (${zone})`} htmlFor="deadlineBarAt" hint="Only for “a set time”.">
              <Input id="deadlineBarAt" name="deadlineBarAt" type="datetime-local" defaultValue={utcToZonedLocal(funnel.deadlineBarAt, timeZone)} />
            </Field>
            <Field label="Message" htmlFor="deadlineBarText" hint="Tokens: {date} = Wednesday, November 11 at 2:00 PM EST · {short_date} = 11/11/2026." className="sm:col-span-2">
              <Input id="deadlineBarText" name="deadlineBarText" defaultValue={funnel.deadlineBarText} maxLength={200} />
            </Field>
            <Field label="Position" htmlFor="deadlineBarPosition">
              <select id="deadlineBarPosition" name="deadlineBarPosition" defaultValue={funnel.deadlineBarPosition} className="pc-control w-full text-sm">
                <option value="header">In the header: logo, message + flip clock, button (sticky)</option>
                <option value="top">Top of the page</option>
                <option value="bottom">Bottom of the page</option>
              </select>
            </Field>
            <Field advanced label="Only in the last … hours" htmlFor="deadlineBarWithinHours" hint="0 = always.">
              <Input id="deadlineBarWithinHours" name="deadlineBarWithinHours" type="number" min={0} defaultValue={funnel.deadlineBarWithinHours} />
            </Field>
          </div>
          <Check name="deadlineBarSticky" label="Sticky (stays on screen while scrolling)" defaultChecked={funnel.deadlineBarSticky} />
          <Check advanced name="deadlineBarDismiss" label="Visitors can close it" defaultChecked={funnel.deadlineBarDismiss} hint="Adds a × button. Closing it is remembered for the rest of the visit, until the deadline changes." />
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Show on</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {pageKinds.map((page) => (
                <label key={page} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="deadlineBarPages" value={page} defaultChecked={pages.includes(page)} className="h-4 w-4 accent-accent" /> {DEADLINE_PAGE_LABELS[page]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" htmlFor="deadlineBarButtonText" hint="Optional. Empty = no button.">
              <Input id="deadlineBarButtonText" name="deadlineBarButtonText" defaultValue={funnel.deadlineBarButtonText} maxLength={40} />
            </Field>
            <Field label="Button goes to" htmlFor="deadlineBarButtonUrl" hint="A web address, a module, or #offer (the offer section on module pages).">
              <Input id="deadlineBarButtonUrl" name="deadlineBarButtonUrl" defaultValue={funnel.deadlineBarButtonUrl} list="deadline-targets" placeholder="https://, module:1 or #offer" maxLength={500} />
              <datalist id="deadline-targets">
                <option value="#offer">Offer section</option>
                {days.map((day) => (
                  <option key={day.id} value={`module:${day.position}`}>
                    {dayLabel(day)}
                  </option>
                ))}
              </datalist>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ColorField name="deadlineBarBg" label="Background" value={safeColor(funnel.deadlineBarBg, "#b42318")} />
            <ColorField name="deadlineBarColor" label="Text" value={safeColor(funnel.deadlineBarColor, "#ffffff")} />
            <Field label="Countdown digits" htmlFor="deadlineBarDigitColor" hint="#rrggbb, or blank = text colour.">
              <Input id="deadlineBarDigitColor" name="deadlineBarDigitColor" defaultValue={funnel.deadlineBarDigitColor ?? ""} maxLength={7} className="font-mono" />
            </Field>
            <Field label="Button colour" htmlFor="deadlineBarButtonBg" hint="#rrggbb, or blank = accent.">
              <Input id="deadlineBarButtonBg" name="deadlineBarButtonBg" defaultValue={funnel.deadlineBarButtonBg ?? ""} maxLength={7} className="font-mono" />
            </Field>
          </div>
          <Field advanced label="Spacing on desktop" htmlFor="deadlineBarSpacing">
            <select id="deadlineBarSpacing" name="deadlineBarSpacing" defaultValue={funnel.deadlineBarSpacing} className="pc-control w-full text-sm">
              <option value="narrow">Narrow: grouped around the countdown</option>
              <option value="wide">Wide: spread across the bar</option>
            </select>
          </Field>
          {canWrite ? <Button type="submit">Save deadline bar</Button> : null}
        </Section>
      </fieldset>
    </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DesignTab({ funnel, days, navItems, themes, otherFunnels, canWrite }: { funnel: FunnelRow; days: DayRow[]; navItems: NavItemRow[]; themes: { id: string; name: string }[]; otherFunnels: { id: string; name: string }[]; canWrite: boolean }) {
  const hasDraft = hasDraftValue(funnel.designDraft);
  const saved: DesignPayload = {
    design: funnelDesign(funnel),
    logoAssetId: funnel.logoAssetId,
    logoUrl: funnel.logoUrl,
    companyName: funnel.companyName,
    privacyUrl: funnel.privacyUrl,
    termsUrl: funnel.termsUrl,
    footerHtml: funnel.footerHtml,
    formThemeId: funnel.formThemeId,
  };
  const initial = hasDraft ? parseDesignDraft(funnel.designDraft, funnel) : saved;
  const firstPage = navItems.find((item) => item.kind === "page");
  const paths = [
    { label: funnel.siteType === "microsite" ? "Home page" : "Front door", path: "" },
    ...(days[0] ? [{ label: dayLabel(days[0]), path: `/day-${days[0].position}` }] : []),
    ...(firstPage ? [{ label: `Page: ${firstPage.title || firstPage.label}`, path: `/p/${firstPage.slug}` }] : []),
  ];
  const copyForm =
    canWrite && otherFunnels.length ? (
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-base font-semibold">Copy design from another funnel</h2>
        <p className="mt-1 text-sm text-muted">Replaces this funnel's whole design (header, page, content box, tiles, footer, logo and legal links) with a copy. Its images are copied too.</p>
        <form action={copyDesignFrom} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="funnelId" value={funnel.id} />
          <Field label="Funnel" htmlFor="sourceId">
            <select id="sourceId" name="sourceId" className="pc-control w-full min-w-[14rem] text-sm" required defaultValue="">
              <option value="" disabled>
                Pick a funnel
              </option>
              {otherFunnels.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="secondary" className="mb-0.5">
            Copy design
          </Button>
        </form>
      </section>
    ) : null;
  return (
    <DesignEditor
      funnelId={funnel.id}
      publicPath={`/l/${funnel.slug}`}
      initial={initial}
      themes={themes.map((theme) => ({ value: theme.id, label: theme.name }))}
      previewPaths={paths}
      canWrite={canWrite}
      hasDraft={hasDraft}
      copyForm={copyForm}
    />
  );
}
