import { CUB_SCORES, formatDeadline, type CubAverages } from "../../../../../modules/editorial/cub";
import { Section } from "./ui";

type Review = { id: string; reviewerName: string; filename: string; size: number; submittedAt: Date; comments: string | null };

function kb(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Averages and the revision list. Shared by the signed-in page and the public owner page. */
export function CubRoundBody({
  round,
  averages,
  reviews,
  hrefs,
}: {
  round: { promoName: string; instructions: string | null; draftFilename: string; dueAt: Date; closedAt: Date | null };
  averages: CubAverages;
  reviews: Review[];
  hrefs: { draft: string; file: (id: string) => string; zip: string };
}) {
  const overdue = round.dueAt.getTime() < Date.now();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Due {formatDeadline(round.dueAt)}
        {round.closedAt ? " · closed" : overdue ? " · past the deadline (late revisions are still accepted)" : ""} ·{" "}
        <a href={hrefs.draft} className="font-medium text-accent">
          Draft: {round.draftFilename}
        </a>
      </p>
      {round.instructions ? <p className="whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-sm">{round.instructions}</p> : null}
      <Section title={`Average scores · ${averages.count} review${averages.count === 1 ? "" : "s"}`}>
        {averages.count ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CUB_SCORES.map((s) => (
              <div key={s.key} className="rounded-lg border border-line px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{averages[s.key]?.toFixed(1)}</dd>
              </div>
            ))}
            <div className="col-span-2 rounded-lg border border-accent bg-[#eef4ff] px-3 py-2 sm:col-span-1">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#1e3a8a]">All four</dt>
              <dd className="text-xl font-semibold tabular-nums text-[#1e3a8a]">{averages.overall?.toFixed(1)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">No reviews yet.</p>
        )}
        <p className="mt-2 text-xs text-muted">Scores are anonymous: only averages are shown, never next to a name.</p>
      </Section>
      <Section
        title={`Revisions · ${reviews.length}`}
        action={
          reviews.length ? (
            <a href={hrefs.zip} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
              Download all (.zip)
            </a>
          ) : null
        }
      >
        <ul className="divide-y divide-line">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">{r.reviewerName}</p>
                <p className="text-xs text-muted">Submitted {r.submittedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
                {r.comments ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.comments}</p> : null}
              </div>
              <a href={hrefs.file(r.id)} className="break-words [overflow-wrap:anywhere] text-sm font-medium text-accent">
                {r.filename} ({kb(r.size)})
              </a>
            </li>
          ))}
          {reviews.length === 0 ? <li className="py-2 text-sm text-muted">Nothing yet.</li> : null}
        </ul>
      </Section>
    </div>
  );
}
