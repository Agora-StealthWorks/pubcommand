import { Button, Input, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { submitCubReviewAction } from "@/features/calendar/cub-actions";
import { roundByToken } from "@/features/calendar/cub";
import { CUB_SCORES, formatDeadline } from "../../../../../../../../../../modules/editorial/cub";

export default async function CubReviewPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { slug, token } = await params;
  const query = await searchParams;
  const found = await roundByToken(slug, "review", token);
  if (!found) notFound();
  const { round, brandName } = found;
  if (query.done === "1") {
    return (
      <div className="rounded-xl border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">Thank you</h1>
        <p className="mt-2 text-sm text-muted">
          Your revision and scores for <strong className="text-ink">{round.promoName}</strong> were received. Your scores stay anonymous: the writer sees only
          the team averages.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-line bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{brandName} · CUB review</p>
        <h1 className="mt-1 break-words [overflow-wrap:anywhere] text-2xl font-semibold">{round.promoName}</h1>
        <p className="mt-1 text-sm text-muted">Due {formatDeadline(round.dueAt)}</p>
        {round.instructions ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{round.instructions}</p> : null}
        <a href={`/p/cub/r/${token}/draft`} className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
          Download the draft
        </a>
      </header>
      <Flash error={query.error} />
      {round.closedAt ? (
        <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">This review round is closed.</p>
      ) : (
        <form action={submitCubReviewAction} className="space-y-4 rounded-xl border border-line bg-white p-5">
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className="text-sm font-medium">Your name</span>
            <Input name="reviewerName" required maxLength={120} className="mt-1" autoComplete="name" />
            <span className="mt-1 block text-xs text-muted">Shown with your revision file. Never with your scores.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Your marked-up copy</span>
            <input name="revision" type="file" required className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-5 text-sm" />
          </label>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Scores, 0 to 10 (anonymous)</legend>
            {CUB_SCORES.map((s) => (
              <label key={s.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center">
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted">{s.hint}</span>
                </span>
                <select name={s.key} required defaultValue="" className="pc-control w-full">
                  <option value="" disabled>
                    Score
                  </option>
                  {Array.from({ length: 11 }, (_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="text-sm font-medium">Comments (optional)</span>
            <Textarea name="comments" rows={4} className="mt-1" />
          </label>
          <Button type="submit" className="w-full sm:w-auto">
            Submit revision and scores
          </Button>
        </form>
      )}
    </div>
  );
}
