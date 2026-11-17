import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { CopyLink } from "@/features/calendar/copy-link";
import { closeCubRoundAction, deleteCubRoundAction, resendCubRequestAction } from "@/features/calendar/cub-actions";
import { findPromo } from "@/features/calendar/promos";
import { PromoLine, Section } from "@/features/calendar/ui";
import { emailConfigured } from "@/lib/email";
import { Textarea } from "@pubcommand/ui";
import { TEMPLATES, isCubEmailKind } from "../../../../../../../../../../modules/editorial/emails";
import { cubLinks, roundReviews } from "@/features/calendar/cub";
import { CubRoundBody } from "@/features/calendar/cub-view";
import { calendarPage, UUID } from "@/features/calendar/context";

export default async function CubRoundPage({ params, searchParams }: { params: Promise<{ slug: string; roundId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, roundId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(roundId)) notFound();
  const round = await tenantDb(ctx.resolved.id).calendarCubRound.findFirst({
    where: { id: roundId, brandId: ctx.brand.id },
    select: { id: true, promoName: true, promoId: true, instructions: true, draftFilename: true, dueAt: true, closedAt: true, reviewToken: true, ownerToken: true, reviewerEmails: true, requestSentAt: true, reminderSentAt: true, deadlineNotifiedAt: true },
  });
  if (!round) notFound();
  const [promo, emails] = await Promise.all([
    findPromo(ctx.resolved.id, ctx.brand.id, round.promoId),
    tenantDb(ctx.resolved.id).calendarEmailLog.findMany({ where: { roundId: round.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const mailReady = emailConfigured();
  const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const [{ averages, reviews }, links] = await Promise.all([roundReviews(ctx.resolved.id, round.id), cubLinks(round)]);
  const base = `/editorial/cub/${round.id}`;
  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <p className="text-sm">
        <Link href="/editorial/cub" className="font-medium text-accent">
          ← All rounds
        </Link>
      </p>
      <h2 className="break-words [overflow-wrap:anywhere] text-xl font-semibold">{round.promoName}</h2>
      {promo ? (
        <div className="text-sm">
          <span className="text-muted">Promo: </span>
          <PromoLine promo={promo} />
        </div>
      ) : null}
      {ctx.canWrite ? (
        <div className="grid gap-3 rounded-xl border border-line bg-white p-4">
          <CopyLink label="Reviewer link (send to your reviewers)" url={links.review} />
          <CopyLink label="Owner link (revisions and averages, no sign-in)" url={links.owner} />
          <p className="text-xs text-muted">
            {mailReady ? "Reviewers got the reviewer link by email. " : "Email is not set up yet, so copy these links into your own message. "}
            Anyone with a link can use it.
          </p>
        </div>
      ) : null}
      {ctx.canWrite ? (
        <Section title="Emails">
          {!mailReady ? <p className="mb-3 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">Email is not set up yet: emails below were logged, not sent.</p> : null}
          <ul className="mb-3 space-y-1 text-sm">
            <li>Request: {round.requestSentAt ? when(round.requestSentAt) : "not sent"}</li>
            <li>Reminder (9:05 am ET, business day before): {round.reminderSentAt ? when(round.reminderSentAt) : "not yet"}</li>
            <li>Revisions ready (after the deadline): {round.deadlineNotifiedAt ? when(round.deadlineNotifiedAt) : "not yet"}</li>
          </ul>
          {emails.length ? (
            <ul className="mb-3 divide-y divide-line rounded-lg border border-line text-sm">
              {emails.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>{isCubEmailKind(m.kind) ? TEMPLATES[m.kind].label : m.kind}</span>
                  <span className="text-muted">
                    {m.status === "logged" ? "not sent (email not set up)" : m.status} · {m.recipients} recipient{m.recipients === 1 ? "" : "s"} · {when(m.createdAt)}
                    {m.error ? ` · ${m.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <form action={resendCubRequestAction} className="space-y-2">
            <input type="hidden" name="roundId" value={round.id} />
            <label className="block text-sm font-medium" htmlFor="reviewers">
              Reviewers
            </label>
            <Textarea id="reviewers" name="reviewers" rows={2} defaultValue={round.reviewerEmails.join(", ")} />
            <Button type="submit" variant="secondary">
              Send the request again
            </Button>
          </form>
        </Section>
      ) : null}
      <CubRoundBody round={round} averages={averages} reviews={reviews} hrefs={{ draft: `${base}/draft`, file: (id) => `${base}/files/${id}`, zip: `${base}/zip` }} />
      {ctx.canWrite ? (
        <div className="flex flex-wrap gap-2">
          <form action={closeCubRoundAction}>
            <input type="hidden" name="roundId" value={round.id} />
            {round.closedAt ? <input type="hidden" name="reopen" value="1" /> : null}
            <Button type="submit" variant="secondary">
              {round.closedAt ? "Reopen round" : "Close round"}
            </Button>
          </form>
          <details className="rounded-md">
            <summary className="inline-flex min-h-11 cursor-pointer items-center px-2 text-sm font-semibold text-[#b42318]">Delete…</summary>
            <form action={deleteCubRoundAction} className="mt-2">
              <input type="hidden" name="roundId" value={round.id} />
              <Button type="submit" variant="danger">
                Delete round and all revisions
              </Button>
            </form>
          </details>
        </div>
      ) : null}
    </div>
  );
}
