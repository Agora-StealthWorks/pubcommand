import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { deleteChannelAction, saveChannelAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, listPublications } from "@/features/calendar/data";
import { canManagePublications } from "@/features/pubsetup/module";
import { Field, PubChip, Section } from "@/features/calendar/ui";
import { tenantDb } from "@pubcommand/db";
import { loadOptions } from "@/features/calendar/options";
import { AirtablePanel, EmailsPanel, OptionsPanel, TrashPanel } from "@/features/calendar/setup-panels";

const SETUP_TABS = [
  ["general", "Publications and channels"],
  ["options", "Field options"],
  ["emails", "Emails"],
  ["trash", "Trash"],
  ["airtable", "Airtable"],
] as const;
type SetupTab = (typeof SETUP_TABS)[number][0];

export default async function SetupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; tab?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const [publications, channels] = await Promise.all([listPublications(ctx.resolved.id, ctx.brand.id, true), listChannels(ctx.resolved.id, ctx.brand.id)]);
  const canManage = canManagePublications(ctx.subject, ctx.scope);
  const tab: SetupTab = SETUP_TABS.some(([key]) => key === query.tab) ? (query.tab as SetupTab) : "general";
  const tabs = (
    <nav className="flex flex-wrap gap-1" aria-label="Setup sections">
      {SETUP_TABS.map(([key, label]) => (
        <Link
          key={key}
          href={key === "general" ? "/editorial/setup" : `/editorial/setup?tab=${key}`}
          className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${tab === key ? "bg-accent text-white" : "border border-line bg-white hover:bg-canvas"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
  if (tab !== "general") {
    const [options, saved] = tab === "options" ? await Promise.all([loadOptions(ctx.resolved.id, ctx.brand.id), tenantDb(ctx.resolved.id).calendarFieldOption.findMany({ where: { brandId: ctx.brand.id }, select: { field: true }, distinct: ["field"] })]) : [null, []];
    return (
      <div className="max-w-4xl space-y-5">
        <Flash error={query.error} notice={query.notice} />
        {tabs}
        {tab === "options" && options ? <OptionsPanel options={options} canWrite={ctx.canWrite} customized={new Set(saved.map((r) => r.field))} /> : null}
        {tab === "emails" ? <EmailsPanel organizationId={ctx.resolved.id} brandId={ctx.brand.id} canWrite={ctx.canWrite} /> : null}
        {tab === "trash" ? <TrashPanel organizationId={ctx.resolved.id} brandId={ctx.brand.id} canWrite={ctx.canWrite} /> : null}
        {tab === "airtable" ? <AirtablePanel organizationId={ctx.resolved.id} brandId={ctx.brand.id} canWrite={ctx.canWrite} /> : null}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <Flash error={query.error} notice={query.notice} />
      {tabs}
      <Section title={`Publications · ${publications.length}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-64 text-sm text-muted">
            Each newsletter or list {ctx.brand.name} mails. The code is how send stats find the right issues. Publications, their editors and branding are managed in Publication Setup.
          </p>
          {canManage ? (
            <Link href="/publication-setup" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
              Manage in Publication Setup →
            </Link>
          ) : (
            <span className="text-xs text-muted">Ask an admin to add or change publications.</span>
          )}
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {publications.map((pub) => (
            <li key={pub.id} className="flex flex-wrap items-center gap-3 p-3">
              {pub.hasLogo ? <img src={`/editorial/setup/logo/${pub.id}`} alt="" className="h-8 w-8 rounded object-contain" /> : null}
              <PubChip code={pub.code} color={pub.color} />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">{pub.name}</span>
              {!pub.active ? <span className="text-xs text-muted">Retired</span> : null}
              {canManage ? (
                <Link href={`/publication-setup/publications/${pub.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
                  Edit
                </Link>
              ) : null}
            </li>
          ))}
          {publications.length === 0 ? <li className="p-4 text-sm text-muted">No publications yet.</li> : null}
        </ul>
      </Section>

      <Section title={`Channels and rooms · ${channels.length}`}>
        <p className="mb-3 text-sm text-muted">Optional. Where events happen: a webinar room, a livestream, a podcast feed, a venue. Used to filter the calendar.</p>
        <ul className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-2 rounded-md border border-line py-1 pl-2 pr-1 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-hidden />
              {c.name}
              {ctx.canWrite ? (
                <form action={deleteChannelAction}>
                  <input type="hidden" name="channelId" value={c.id} />
                  <button type="submit" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-canvas" aria-label={`Remove ${c.name}`}>
                    ×
                  </button>
                </form>
              ) : null}
            </li>
          ))}
          {channels.length === 0 ? <li className="text-sm text-muted">None yet.</li> : null}
        </ul>
        {ctx.canWrite ? (
          <form action={saveChannelAction} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="New channel">
              <Input name="name" required maxLength={80} />
            </Field>
            <input type="color" name="color" defaultValue="#27455c" aria-label="Color" className="h-11 w-14 rounded-md border border-line bg-white" />
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        ) : null}
      </Section>
    </div>
  );
}
