import { tenantDb } from "@pubcommand/db";
import { Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { createCubRoundAction } from "@/features/calendar/cub-actions";
import { calendarPage } from "@/features/calendar/context";
import { Field, Section } from "@/features/calendar/ui";
import { averageScores, defaultDeadline, formatDeadline, toZonedInput } from "../../../../../../../../../modules/editorial/cub";
import { TEMPLATES } from "../../../../../../../../../modules/editorial/emails";
import { isOpenPromoStage } from "../../../../../../../../../modules/editorial/options";
import { loadTemplate } from "@/features/calendar/cub-emails";
import { listPromos } from "@/features/calendar/promos";
import { PromoSelect } from "@/features/calendar/ui";
import { emailConfigured } from "@/lib/email";

export default async function CubPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const rounds = await db.calendarCubRound.findMany({
    where: { brandId: ctx.brand.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, promoName: true, dueAt: true, closedAt: true, createdAt: true, reviews: { select: { scoreHeadline: true, scoreStory: true, scoreOffer: true, scoreOverall: true } } },
  });
  const [promos, requestTpl] = await Promise.all([listPromos(ctx.resolved.id, ctx.brand.id), loadTemplate(ctx.resolved.id, ctx.brand.id, "cub-request")]);
  const openPromos = promos.filter((p) => isOpenPromoStage(p.stage));
  const mailReady = emailConfigured();

  return (
    <div className="max-w-4xl space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <div>
        <h2 className="text-xl font-semibold">CUB Collector</h2>
        <p className="text-sm text-muted">
          A peer-review round on a near-final promo draft. Reviewers open a private link (no sign-in), download the draft, upload their marked-up copy and give
          four anonymous scores from 0 to 10. You get every revision in one zip and the average scores.
        </p>
      </div>
      {ctx.canWrite ? (
        <Section title="Start a round">
          {!mailReady ? (
            <p className="mb-3 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
              Email is not set up yet, so nothing will be sent. The round still works: copy the reviewer link from the next page.
            </p>
          ) : null}
          <form action={createCubRoundAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <PromoSelect promos={openPromos} hint="Moves the promo to the CUB stage and saves the draft on it as its Cub draft." />
              <Field label="Or type the promo name">
                <Input name="promoName" maxLength={200} placeholder="Only if it is not in Promo Analyzer" />
              </Field>
            </div>
            <Field label="Draft" hint="Word or PDF, up to 50 MB. Attached to the email when 10 MB or smaller.">
              <input name="draft" type="file" required accept=".docx,.doc,.pdf,.txt,.rtf,.odt" className="block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-5 text-sm" />
            </Field>
            <Field label="Deadline (Eastern time)" hint="Defaults to two business days from now at 3:30 pm. Reviewers get a reminder at 9:05 am the business day before.">
              <input name="dueAt" type="datetime-local" required className="pc-control w-full sm:w-auto" defaultValue={toZonedInput(defaultDeadline(new Date()), "America/New_York")} />
            </Field>
            <Field label="Reviewers" hint="Email addresses, separated by commas or new lines. Starts with your saved reviewer group.">
              <Textarea name="reviewers" rows={3} defaultValue={requestTpl.recipients.join(", ")} placeholder="name@company.com" />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="saveGroup" value="1" /> Save these addresses as the reviewer group
            </label>
            <Field label="Note to reviewers (optional)">
              <Textarea name="instructions" rows={3} placeholder="What should reviewers focus on?" />
            </Field>
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">Edit the request email</summary>
              <div className="mt-3 space-y-3">
                <Field label="Subject">
                  <Input name="emailSubject" maxLength={250} defaultValue={requestTpl.subject} />
                </Field>
                <Field label="Body" hint={`Merge fields: ${TEMPLATES["cub-request"].mergeFields.map((f) => `{{${f.token}}}`).join(" ")}`}>
                  <Textarea name="emailBody" rows={10} defaultValue={requestTpl.body} />
                </Field>
                <p className="text-xs text-muted">This changes this round only. Change the saved wording under Setup → Emails.</p>
              </div>
            </details>
            <Button type="submit" className="w-full sm:w-auto">
              {mailReady ? "Create round and email reviewers" : "Create round"}
            </Button>
          </form>
        </Section>
      ) : null}
      <Section title={`Rounds · ${rounds.length}`}>
        <ul className="divide-y divide-line">
          {rounds.map((r) => {
            const avg = averageScores(r.reviews);
            return (
              <li key={r.id}>
                <Link href={`/editorial/cub/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-accent">
                  <span className="min-w-0">
                    <span className="block break-words [overflow-wrap:anywhere] font-medium">{r.promoName}</span>
                    <span className="block text-xs text-muted">
                      Due {formatDeadline(r.dueAt)}
                      {r.closedAt ? " · closed" : ""}
                    </span>
                  </span>
                  <span className="text-sm text-muted">
                    {avg.count} review{avg.count === 1 ? "" : "s"}
                    {avg.overall != null ? ` · avg ${avg.overall.toFixed(1)}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
          {rounds.length === 0 ? <li className="py-3 text-sm text-muted">No rounds yet.</li> : null}
        </ul>
      </Section>
    </div>
  );
}
