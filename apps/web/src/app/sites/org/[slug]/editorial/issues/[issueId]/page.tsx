import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { deleteIssueAction, issueAssistAction } from "@/features/calendar/actions";
import { AssistPanel } from "@/features/calendar/assist-panel";
import { calendarPage } from "@/features/calendar/context";
import { listPublications, loadIssue } from "@/features/calendar/data";
import { count, ExternalLink, LinkButton, money, pct, PromoLine, PubChip, Section, Stat } from "@/features/calendar/ui";
import { findPromo } from "@/features/calendar/promos";
import { fmtDayFull, toDay } from "../../../../../../../../../../modules/editorial/dates";

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; issueId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, issueId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const [loaded, publications] = await Promise.all([loadIssue(ctx.resolved.id, ctx.brand.id, issueId), listPublications(ctx.resolved.id, ctx.brand.id, true)]);
  if (!loaded) notFound();
  const { issue: i, mailDate } = loaded;
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, i.promoId);
  const pub = publications.find((p) => p.code === i.publicationCode);
  const s = i.stat;
  const revPerThousand = s?.revenue != null && s.delivered ? (s.revenue / s.delivered) * 1000 : null;

  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <PubChip code={i.publicationCode} color={pub?.color} /> {pub?.name ?? "Unknown publication"}
          </p>
          <h2 className="mt-1 break-words [overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">{i.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {mailDate ? `Mails ${fmtDayFull(mailDate)}` : "No mail date"} · {i.status}
            {i.issueType ? ` · ${i.issueType}` : ""}
            {i.writer ? ` · ${i.writer}` : ""}
          </p>
        </div>
        {ctx.canWrite ? (
          <LinkButton href={`/editorial/issues/${i.id}/edit`} primary>
            Edit
          </LinkButton>
        ) : null}
      </header>

      <section className="rounded-xl border border-[#c7d7fe] bg-[#f5f8ff] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#1e3a8a]">Send stats</h2>
          {s ? <span className="text-xs text-muted">Imported {s.updatedAt.toISOString().slice(0, 10)}{s.listLabel ? ` · ${s.listLabel}` : ""}</span> : null}
        </div>
        {s ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Mailed" value={count(s.delivered)} />
              <Stat label="Open rate" value={pct(s.openRate)} />
              <Stat label="Click rate" value={pct(s.clickRate)} />
              <Stat label="Click-to-open" value={pct(s.clickToOpen ?? (s.clickRate != null && s.openRate ? s.clickRate / s.openRate : null))} />
              <Stat label="Revenue" value={money(s.revenue)} />
              <Stat label="Revenue / 1,000 mailed" value={money(revPerThousand == null ? null : Math.round(revPerThousand * 100) / 100)} />
              <Stat label="Unsubscribes" value={count(s.unsubscribes)} />
              <Stat label="Complaints" value={count(s.complaints)} />
            </dl>
            {s.subject ? <p className="mt-3 break-words [overflow-wrap:anywhere] text-sm text-muted">Matched send: “{s.subject}” on {fmtDayFull(toDay(s.mailDate))}</p> : null}
          </>
        ) : (
          <p className="text-sm text-muted">
            No stats yet. <Link href="/editorial/stats" className="font-medium text-accent">Import your ESP export</Link>; rows match this issue by mail date and publication code.
          </p>
        )}
      </section>

      <Section title="Details">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-muted">Subject lines</dt>
            <dd className="mt-1 space-y-1">{i.subjectLines.length ? i.subjectLines.map((line) => <p key={line} className="break-words [overflow-wrap:anywhere] font-medium">{line}</p>) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Offer</dt>
            <dd className="break-words [overflow-wrap:anywhere] font-medium">{i.offer ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Promo</dt>
            <dd className="mt-1">
              <PromoLine promo={promo} />
            </dd>
          </div>
          {i.tickers.length ? (
            <div>
              <dt className="text-muted">Tickers</dt>
              <dd className="font-medium">{i.tickers.join(", ")}</dd>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <ExternalLink href={i.websiteLink}>Web version ↗</ExternalLink>
            <ExternalLink href={i.ctaLink}>Call-to-action link ↗</ExternalLink>
          </div>
        </dl>
        {i.notes ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{i.notes}</p> : null}
      </Section>

      {i.body ? (
        <Section title="Body or outline">
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{i.body}</div>
        </Section>
      ) : null}

      {ctx.canWrite ? (
        <Section title="Writing assistant">
          <AssistPanel issueId={i.id} action={issueAssistAction} />
        </Section>
      ) : null}

      {ctx.canWrite ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete…</summary>
          <form action={deleteIssueAction} className="mt-3">
            <input type="hidden" name="issueId" value={i.id} />
            <Button type="submit" variant="danger">
              Move this issue to the trash
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
