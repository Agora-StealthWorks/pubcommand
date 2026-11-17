import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { CopyLink } from "@/features/calendar/copy-link";
import { closeCubRoundAction, deleteCubRoundAction } from "@/features/calendar/cub-actions";
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
    select: { id: true, promoName: true, instructions: true, draftFilename: true, dueAt: true, closedAt: true, reviewToken: true, ownerToken: true },
  });
  if (!round) notFound();
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
      {ctx.canWrite ? (
        <div className="grid gap-3 rounded-xl border border-line bg-white p-4">
          <CopyLink label="Reviewer link (send to your reviewers)" url={links.review} />
          <CopyLink label="Owner link (revisions and averages, no sign-in)" url={links.owner} />
          <p className="text-xs text-muted">Email is not connected yet, so copy these links into your own message. Anyone with a link can use it.</p>
        </div>
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
