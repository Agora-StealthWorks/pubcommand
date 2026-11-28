import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteFunnel, duplicateFunnel, publishFunnel } from "@/features/funnels/actions";
import { DeadlineTab, DesignTab, HomeTab, HostsTab, OfferTab, PagesTab } from "@/features/funnels/builder-tabs";
import { AdvancedToggle } from "@/features/funnels/advanced-toggle";
import { AgendaSettings, ChecksList, CloseTab, LandingTab, ModulesTab, ProgressionTab, ScheduleTab, SetupTab } from "@/features/funnels/builder-main-tabs";
import { dayLabel, funnelDesign, loadFunnelForBrand, orgTimezone, statusBadge, type DayRow, type FunnelRow } from "@/features/funnels/data";
import { Field, LinkBox, Section } from "@/features/funnels/fields";
import { funnelCheckInput } from "@/features/funnels/site-data";
import { funnelLinks, funnelsAccess } from "@/features/funnels/guard";
import { SectionTabs } from "@/features/funnels/tabs";
import { AdvancedTab, DelegatesTab, SmsFormsTab } from "@/features/funnels/more-tabs";
import { LinksTab, type FunnelLink } from "@/features/funnels/links-tab";
import { loadFunnelsSettings } from "@/features/funnels/tracking-data";
import { listSmsForms, type SmsFormRow } from "@/features/funnels/sms-data";
import { checkFunnel } from "../../../../../../../../../modules/funnels/checks";
import { PROGRESSIONS, PROGRESSION_LABELS, SITE_TYPE_LABELS, keyUnlocks, type Progression } from "../../../../../../../../../modules/funnels/state";
import { utcToZonedLocal, zoneLabel } from "../../../../../../../../../modules/funnels/time";

/** The builder tabs, grouped the way the old Launch Funnels editor grouped them, plus PubCommand's own. */
const TABS = [
  { key: "setup", label: "Setup" },
  { key: "schedule", label: "Mode & schedule" },
  { key: "progression", label: "Progression & messages" },
  { key: "days", label: "Modules" },
  { key: "pages", label: "Pages & links" },
  { key: "home", label: "Home page" },
  { key: "waitlist", label: "Waitlist page" },
  { key: "hosts", label: "Hosts" },
  { key: "deadline", label: "Deadline bar" },
  { key: "design", label: "Design" },
  { key: "close", label: "Close page" },
  { key: "links", label: "Links" },
  { key: "sms", label: "SMS forms" },
  { key: "advanced", label: "Advanced" },
  { key: "delegates", label: "Delegates" },
  { key: "publish", label: "Publish" },
  { key: "offer", label: "Offer section" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * The builder's top-level groups: the tabs above, gathered into fewer places. Every tab
 * keeps its own ?tab= key (links and saves still land on it); a group with more than one
 * tab shows them as a second row.
 */
const GROUPS: { key: string; label: string; tabs: Tab[] }[] = [
  { key: "setup", label: "Setup & publish", tabs: ["setup", "publish"] },
  { key: "design", label: "Design", tabs: ["design"] },
  { key: "schedule", label: "Schedule & access", tabs: ["schedule", "progression"] },
  { key: "days", label: "Modules", tabs: ["days"] },
  { key: "pages", label: "Pages", tabs: ["home", "waitlist", "pages", "hosts", "close"] },
  { key: "deadline", label: "Countdowns & bars", tabs: ["deadline"] },
  { key: "offer", label: "Offer section", tabs: ["offer"] },
  { key: "links", label: "Links", tabs: ["links"] },
  { key: "forms", label: "SMS forms", tabs: ["sms"] },
  { key: "advanced", label: "Advanced", tabs: ["advanced", "delegates"] },
];

/** Old tab names still open the right tab. */
const ALIASES: Record<string, string> = { branding: "design", landing: "waitlist", messages: "progression", emails: "links" };

export default async function FunnelBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; funnelId: string }>;
  searchParams: Promise<{ tab?: string; day?: string; host?: string; item?: string; email?: string; form?: string; error?: string; notice?: string }>;
}) {
  const { slug, funnelId } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug, "funnels.read", funnelId);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canPublish, delegate } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) notFound();
  const { funnel, days, hosts, navItems } = loaded;
  const db = tenantDb(ctx.resolved.id);
  const [timeZone, themes, forms, otherFunnels, domains] = await Promise.all([
    orgTimezone(ctx.resolved.id),
    db.formTheme.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.form.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, status: "OPEN" }, orderBy: { title: "asc" }, select: { slug: true, title: true } }),
    db.funnel.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, id: { not: funnel.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.customDomain.findMany({ where: { targetPath: { in: [`/l/${funnel.slug}`, `/l/${funnel.slug}/`] } }, orderBy: { createdAt: "asc" }, select: { hostname: true, status: true } }),
  ]);
  const microsite = funnel.siteType === "microsite";
  // A microsite's front door is the home page; a launch funnel's is the waitlist.
  // Delegates edit content only: no delegates or code tab for them.
  const tabs = TABS.filter((item) => (microsite ? item.key !== "waitlist" : item.key !== "home")).filter((item) => canPublish || (item.key !== "delegates" && item.key !== "advanced"));
  const asked = ALIASES[query.tab ?? ""] ?? query.tab ?? "";
  const wanted = asked === "home" && !microsite ? "waitlist" : asked === "waitlist" && microsite ? "home" : asked;
  const tab: Tab = (tabs.map((item) => item.key) as readonly string[]).includes(wanted) ? (wanted as Tab) : "setup";
  const available = new Set<string>(tabs.map((item) => item.key));
  const groups = GROUPS.map((group) => ({ ...group, tabs: group.tabs.filter((key) => available.has(key)) })).filter((group) => group.tabs.length > 0);
  const activeGroup = groups.find((group) => group.tabs.includes(tab)) ?? groups[0]!;
  // The funnel's custom domain when one is Active; the PubCommand address only without one.
  const links = await funnelLinks({ organizationId: ctx.resolved.id, orgSlug: ctx.resolved.slug, requestHost: ctx.request.host, funnel });
  const publicUrl = links.root;
  const zone = zoneLabel(new Date(), timeZone);
  const local = (date: Date | null) => utcToZonedLocal(date, timeZone);
  const badge = statusBadge(funnel.status);
  const theme = funnel.formThemeId ? await db.formTheme.findFirst({ where: { id: funnel.formThemeId, deletedAt: null }, select: { privacyPolicyUrl: true } }) : null;
  const checks = checkFunnel(funnelCheckInput(funnel, days, navItems, theme?.privacyPolicyUrl ?? null));
  const smsForms = await listSmsForms(ctx.resolved.id, funnel.id);
  const smsOptions = smsForms.map((form) => ({ id: form.id, name: form.name }));
  const button = "inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas";

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
            <span>{funnel.mode === "live" ? "Live" : "Evergreen"}</span>
            <span>·</span>
            <span>{PROGRESSION_LABELS[(PROGRESSIONS as readonly string[]).includes(funnel.progression) ? (funnel.progression as Progression) : "all_open"]}</span>
          </p>
          <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
            Public:{" "}
            <a href={publicUrl} target="_blank" rel="noopener" className="text-accent">
              {publicUrl}
            </a>
            {domains.filter((domain) => !publicUrl.startsWith(`https://${domain.hostname}/`)).map((domain) => (
              <span key={domain.hostname}>
                {" · "}
                <a href={`https://${domain.hostname}`} target="_blank" rel="noopener" className="text-accent">
                  {domain.hostname}
                </a>
              </span>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Link href={`/funnels/${funnel.id}/stats`} className={button}>
            Stats
          </Link>
          <a href={links.preview()} target="_blank" rel="noopener" className={button}>
            Preview
          </a>
          <form action={links.formAction} method="get" target="_blank" className="flex flex-wrap items-end gap-2" title="Preview as a first-time visitor at the chosen time">
            {links.previewFields.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <input type="hidden" name="fresh" value="1" />
            <label className="sr-only" htmlFor="as_of_head">
              Preview as of ({zone})
            </label>
            <Input id="as_of_head" name="as_of" type="datetime-local" defaultValue="" className="w-auto" />
            <Button type="submit" variant="secondary">
              Preview as of →
            </Button>
          </form>
          {canWrite && !delegate ? (
            <form action={duplicateFunnel}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <Button type="submit" variant="secondary">
                Duplicate
              </Button>
            </form>
          ) : null}
          {canPublish && funnel.status !== "published" ? (
            <form action={publishFunnel}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <Button type="submit" name="intent" value="publish" disabled={checks.errors.length > 0} title={checks.errors.length ? "Fix the errors on Setup first" : undefined}>
                Publish
              </Button>
            </form>
          ) : null}
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      {delegate ? <p className="mb-4 rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">You are a delegate of this funnel: you can edit it, and someone with publish rights takes it live.</p> : null}
      <AdvancedToggle>
      <SectionTabs
        label="Builder sections"
        active={activeGroup.key}
        items={groups.map((group) => ({ key: group.key, label: `${group.label}${group.key === "setup" && checks.errors.length ? " •" : ""}`, href: `/funnels/${funnel.id}?tab=${group.tabs[0]}` }))}
      />
      {activeGroup.tabs.length > 1 ? (
        <SectionTabs label={`${activeGroup.label} sections`} active={tab} items={activeGroup.tabs.map((key) => ({ key, label: tabs.find((item) => item.key === key)!.label, href: `/funnels/${funnel.id}?tab=${key}` }))} />
      ) : null}

      {tab === "setup" ? <SetupTab funnel={funnel} canWrite={canWrite} checks={checks} publicUrl={publicUrl} domains={domains} /> : null}
      {tab === "schedule" ? <ScheduleTab funnel={funnel} canWrite={canWrite} local={local} zone={zone} timeZone={timeZone} /> : null}
      {tab === "progression" ? <ProgressionTab funnel={funnel} canWrite={canWrite} /> : null}
      {tab === "days" ? <ModulesTab funnel={funnel} days={days} selectedId={query.day} smsForms={smsOptions} canWrite={canWrite} local={local} zone={zone} links={links} timeZone={timeZone} /> : null}
      {tab === "waitlist" ? <LandingTab funnel={funnel} canWrite={canWrite} local={local} timeZone={timeZone} forms={forms} smsForms={smsOptions} /> : null}
      {tab === "home" ? (
        <div className="space-y-4">
          <HomeTab funnel={funnel} days={days} navItems={navItems} hosts={hosts} forms={forms} smsForms={smsOptions} timeZone={timeZone} zone={zone} canWrite={canWrite} />
          <AgendaSettings funnel={funnel} canWrite={canWrite} returnTab="home" />
        </div>
      ) : null}
      {tab === "hosts" ? <HostsTab funnel={funnel} hosts={hosts} openId={query.host} canWrite={canWrite} /> : null}
      {tab === "pages" ? <PagesTab funnel={funnel} days={days} navItems={navItems} forms={forms} smsForms={smsOptions} openId={query.item} canWrite={canWrite} links={links} /> : null}
      {tab === "offer" ? <OfferTab funnel={funnel} days={days} navItems={navItems} hosts={hosts} forms={forms} smsForms={smsOptions} timeZone={timeZone} zone={zone} canWrite={canWrite} /> : null}
      {tab === "deadline" ? <DeadlineTab funnel={funnel} days={days} timeZone={timeZone} zone={zone} canWrite={canWrite} /> : null}
      {tab === "links" ? await linksTab(ctx.resolved.id, funnel, days, publicUrl) : null}
      {tab === "sms" ? await smsTab(ctx.resolved.id, funnel, smsForms, canWrite, canPublish, query.form) : null}
      {tab === "advanced" && canPublish ? (
        <div className="space-y-4">
          <AdvancedTab funnel={funnel} canPublish={canPublish} faviconSrc={funnel.faviconAssetId ? `/l/${funnel.slug}/asset/${funnel.faviconAssetId}` : funnel.faviconUrl} />
          <StatusSection funnel={funnel} />
        </div>
      ) : null}
      {tab === "delegates" && canPublish ? await delegatesTab(ctx.resolved.id, funnel) : null}
      {tab === "design" ? <DesignTab funnel={funnel} days={days} navItems={navItems} themes={themes} otherFunnels={otherFunnels} canWrite={canWrite} /> : null}
      {tab === "close" ? <CloseTab funnel={funnel} canWrite={canWrite} /> : null}

      {tab === "publish" ? (
        <div className="space-y-4">
          <Section title="Links">
            <div className="grid gap-4 sm:grid-cols-2">
              <LinkBox label="Public link" value={publicUrl} />
              <LinkBox label="Day 1" value={links.at("/day-1")} />
            </div>
            <form action={links.formAction} method="get" target="_blank" className="flex flex-wrap items-end gap-2">
              {links.previewFields.map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <Field label={`Preview as of (${zone})`} htmlFor="as_of" hint="Time travel: see exactly what a visitor would see at that moment. Drafts work too.">
                <Input id="as_of" name="as_of" type="datetime-local" defaultValue={local(funnel.startAt ?? new Date())} />
              </Field>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="fresh" value="1" defaultChecked className="h-4 w-4 accent-accent" /> As a first-time visitor
              </label>
              <Button type="submit" variant="secondary" className="mb-0.5">
                Open preview
              </Button>
            </form>
          </Section>
          <Section title="Publish checks" description="Errors block publishing. A published funnel stays live while you edit it.">
            <ChecksList checks={checks} />
            {canPublish ? (
              <form action={publishFunnel} className="flex flex-wrap gap-2">
                <input type="hidden" name="funnelId" value={funnel.id} />
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
            <Section title="Opt-ins" description="Email opt-ins captured on the waitlist and other pages. They are personal data: the CSV is for this team only.">
              <div className="flex flex-wrap gap-2">
                <a href={`/funnels/${funnel.id}/optins`} className={button}>
                  Download email opt-ins (CSV)
                </a>
                {smsForms.length ? (
                  <a href={`/funnels/${funnel.id}/sms-optins`} className={button}>
                    Download SMS sign-ups (CSV)
                  </a>
                ) : null}
              </div>
            </Section>
          ) : null}
          {canPublish ? <StatusSection funnel={funnel} /> : null}
        </div>
      ) : null}
      </AdvancedToggle>
    </div>
  );
}

/** Unpublish and delete: rarely needed and hard to undo, so away from Save. */
function StatusSection({ funnel }: { funnel: FunnelRow }) {
  return (
    <Section title="Funnel status" description={funnel.status === "published" ? "Unpublish takes it offline but keeps it as a draft. Delete removes it from the list for good." : "Delete removes this funnel from the list for good."}>
      {funnel.status === "published" ? (
        <form action={publishFunnel}>
          <input type="hidden" name="funnelId" value={funnel.id} />
          <Button type="submit" name="intent" value="unpublish" variant="secondary">
            Unpublish
          </Button>
        </form>
      ) : null}
      <form action={deleteFunnel} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="funnelId" value={funnel.id} />
        <Field label={`Type “${funnel.name}” to delete`} htmlFor={`confirm-${funnel.id}`}>
          <Input id={`confirm-${funnel.id}`} name="confirm" autoComplete="off" />
        </Field>
        <Button type="submit" variant="danger" className="mb-0.5">
          Delete funnel
        </Button>
      </form>
    </Section>
  );
}

async function linksTab(organizationId: string, funnel: FunnelRow, days: DayRow[], publicUrl: string) {
  const settings = await loadFunnelsSettings(organizationId);
  const keyLinks = keyUnlocks(funnel);
  const links: FunnelLink[] = [
    { id: "main", label: funnel.name, detail: "The funnel's main link: it opens whatever each visitor should see now.", url: publicUrl },
    ...days.map((day) => ({
      id: day.id,
      label: day.title ? `${dayLabel(day)}: ${day.title}` : dayLabel(day),
      detail: `Module ${day.position}`,
      url: publicLink(publicUrl, `/day-${day.position}`),
      keyUrl: keyLinks ? publicLink(publicUrl, `/day-${day.position}`, { k: day.unlockKey }) : null,
    })),
    ...(funnel.mode === "live" ? [{ id: "calendar", label: "Add every session to your calendar", detail: "Downloads a calendar file with all live sessions.", url: publicLink(publicUrl, "/ics", { series: "1" }) }] : []),
  ];
  const defaults: Record<string, string> = { utm_source: "email", utm_medium: "email", utm_campaign: funnel.slug };
  return <LinksTab links={links} trackedParams={settings.trackedParams} defaults={defaults} accent={funnelDesign(funnel).page.accent} keyLinks={keyLinks} />;
}

async function smsTab(organizationId: string, funnel: FunnelRow, forms: SmsFormRow[], canWrite: boolean, canPublish: boolean, openId?: string) {
  const db = tenantDb(organizationId);
  const rows = await db.funnelSmsOptin.findMany({ where: { funnelId: funnel.id }, select: { id: true, formId: true, phone: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000 });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.formId, (counts.get(row.formId) ?? 0) + 1);
  return <SmsFormsTab funnel={funnel} forms={forms} counts={counts} recent={rows.slice(0, 200)} openId={openId} canWrite={canWrite} canPublish={canPublish} />;
}

async function delegatesTab(organizationId: string, funnel: FunnelRow) {
  const db = tenantDb(organizationId);
  const [rows, members] = await Promise.all([
    db.funnelDelegate.findMany({ where: { funnelId: funnel.id }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { status: "ACTIVE" }, include: { user: true, role: { include: { grants: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const byUser = new Map(members.map((member) => [member.userId, member]));
  const delegates = rows.map((row) => ({ id: row.id, name: byUser.get(row.userId)?.user.name ?? "", email: byUser.get(row.userId)?.user.email ?? "(no longer a member)", createdAt: row.createdAt }));
  const taken = new Set(rows.map((row) => row.userId));
  // Offer members whose role cannot already write funnels.
  const candidates = members
    .filter((member) => !taken.has(member.userId) && !roleWrites(member.role))
    .map((member) => ({ userId: member.userId, label: `${member.user.name || member.user.email} (${member.role.name})` }));
  return <DelegatesTab funnel={funnel} delegates={delegates} candidates={candidates} canPublish />;
}

/** Does this role allow funnels.write (or everything)? Approximates `can` without loading each member's full subject. */
function roleWrites(role: { grants: { permission: string; effect: string }[] }): boolean {
  const allow = role.grants.filter((grant) => grant.effect === "ALLOW").map((grant) => grant.permission);
  const deny = role.grants.some((grant) => grant.effect === "DENY" && grant.permission === "funnels.write");
  return !deny && allow.some((permission) => permission === "funnels.write" || permission === "*" || permission === "funnels.*");
}
