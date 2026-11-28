import Link from "next/link";
import { reportIspyAction, sendIspyToAnalyzerAction } from "./org-actions";

const button = "inline-flex min-h-10 items-center justify-center rounded-md border px-3 text-sm font-semibold";

/** Send to Promo Analyzer, or open the analysis made earlier (one per org per item). */
export function AnalyzerPanel({ targetType, targetId, feed, back, existingPromoId, allowed }: { targetType: "PROMO" | "COPY"; targetId: string; feed: string; back: string; existingPromoId: string | null; allowed: boolean }) {
  if (existingPromoId) {
    return (
      <Link href={`/promo-studio/${existingPromoId}`} className={`${button} border-line bg-white text-ink hover:bg-canvas`}>
        <span className="mr-2 rounded-full bg-[#dcfae6] px-2 py-0.5 text-xs text-[#067647]">In Analyzer</span> Open analysis
      </Link>
    );
  }
  if (!allowed) return <span className="text-xs text-muted">Send to Promo Analyzer needs Promo Analyzer turned on and promo.write.</span>;
  return (
    <form action={sendIspyToAnalyzerAction}>
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="feed" value={feed} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className={`${button} border-accent bg-accent text-white hover:bg-[#1e40af]`}>
        Send to Promo Analyzer
      </button>
    </form>
  );
}

export type DuplicateResult = { id: string; label: string; meta: string };

/**
 * Report: "Not a promo" or "Duplicate of…". The duplicate picker searches promos (for a
 * promo or email) or copies (for a copy) in the feed with a GET form on the same page.
 */
export function ReportPanel({
  targetType,
  targetId,
  feed,
  back,
  canWrite,
  dupKind,
  dupQuery,
  dupResults,
}: {
  targetType: "EMAIL" | "COPY" | "PROMO";
  targetId: string;
  feed: string;
  back: string;
  canWrite: boolean;
  dupKind: "PROMO" | "COPY";
  dupQuery: string;
  dupResults: DuplicateResult[];
}) {
  if (!canWrite) return null;
  const hidden = (
    <>
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="feed" value={feed} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  const [path, query = ""] = back.split("?");
  const keep = [...new URLSearchParams(query).entries()].filter(([key]) => key !== "dupq" && key !== "notice" && key !== "error");
  return (
    <details className="rounded-xl border border-dashed border-line bg-white p-4" open={Boolean(dupQuery)}>
      <summary className="cursor-pointer text-sm font-semibold text-ink">Report a problem</summary>
      <p className="mt-2 text-xs text-muted">Reports go to PubCommand staff. When they apply one, it sticks: future mail follows the fix.</p>
      <form action={reportIspyAction} className="mt-3 flex flex-wrap items-end gap-2">
        {hidden}
        <input type="hidden" name="kind" value="NOT_A_PROMO" />
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          Note (optional)
          <input name="note" className="pc-control" placeholder="Why it isn't a promo" />
        </label>
        <button type="submit" className={`${button} border-line bg-white text-ink hover:bg-canvas`}>
          Not a promo
        </button>
      </form>
      <form action={path} className="mt-4 flex flex-wrap items-end gap-2">
        {keep.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          Duplicate of… (search {dupKind === "PROMO" ? "promos by headline or URL" : "emails by headline"})
          <input name="dupq" defaultValue={dupQuery} className="pc-control" placeholder="Type a few words" />
        </label>
        <button type="submit" className={`${button} border-line bg-white text-ink hover:bg-canvas`}>
          Search
        </button>
      </form>
      {dupQuery ? (
        dupResults.length ? (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {dupResults.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="pc-break block text-sm font-semibold text-ink">{r.label}</span>
                  <span className="text-xs text-muted">{r.meta}</span>
                </span>
                <form action={reportIspyAction}>
                  {hidden}
                  <input type="hidden" name="kind" value="DUPLICATE" />
                  <input type="hidden" name="duplicateOfId" value={r.id} />
                  <button type="submit" className={`${button} min-h-9 border-line bg-white text-ink hover:bg-canvas`}>
                    Duplicate of this
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing in your feed matches “{dupQuery}”.</p>
        )
      ) : null}
    </details>
  );
}
