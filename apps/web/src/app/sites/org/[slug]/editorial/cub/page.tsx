import { tenantDb } from "@pubcommand/db";
import { Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { createCubRoundAction } from "@/features/calendar/cub-actions";
import { calendarPage } from "@/features/calendar/context";
import { Field, Section } from "@/features/calendar/ui";
import { averageScores, defaultDeadline, formatDeadline, toZonedInput } from "../../../../../../../../../modules/editorial/cub";

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
          <form action={createCubRoundAction} className="space-y-4">
            <Field label="Promo">
              <Input name="promoName" required maxLength={200} placeholder="Name of the promo under review" />
            </Field>
            <Field label="Draft" hint="Word or PDF, up to 50 MB.">
              <input name="draft" type="file" required accept=".docx,.doc,.pdf,.txt,.rtf,.odt" className="block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-5 text-sm" />
            </Field>
            <Field label="Deadline (Eastern time)" hint="Defaults to two business days from now at 3:30 pm.">
              <input name="dueAt" type="datetime-local" required className="pc-control w-full sm:w-auto" defaultValue={toZonedInput(defaultDeadline(new Date()), "America/New_York")} />
            </Field>
            <Field label="Note to reviewers (optional)">
              <Textarea name="instructions" rows={3} placeholder="What should reviewers focus on?" />
            </Field>
            <Button type="submit" className="w-full sm:w-auto">
              Create round
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
