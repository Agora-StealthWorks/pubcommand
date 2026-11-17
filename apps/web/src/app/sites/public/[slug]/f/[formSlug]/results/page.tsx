import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/features/forms/auto-refresh";
import { loadPublicResults } from "@/features/forms/public";
import { FormHeader } from "@/features/forms/renderer";
import { currentRequest } from "@/lib/request";
import type { Bucket } from "../../../../../../../../../../modules/forms/analytics";
import { contrastText } from "../../../../../../../../../../modules/forms/theme";

type Params = Promise<{ slug: string; formSlug: string }>;

export const metadata: Metadata = { robots: { index: false } };

/** Refresh while people are still answering. */
const REFRESH_MS = 10000;

async function load(params: Params) {
  const { slug, formSlug } = await params;
  const request = await currentRequest();
  if (request.site.kind !== "org" || request.site.slug !== slug) return null;
  return loadPublicResults(slug, formSlug);
}

function Bars({ buckets, accent }: { buckets: Bucket[]; accent: string }) {
  return (
    <ul className="mt-2 space-y-2">
      {buckets.map((bucket) => (
        <li key={bucket.label} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="[overflow-wrap:anywhere] min-w-0 text-[#0b1220]">{bucket.label}</span>
            <span className="shrink-0 tabular-nums text-[#5b6577]">{bucket.pct}%</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#eef0f3]">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(bucket.pct, bucket.count ? 1 : 0)}%`, background: accent }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** https://{org}.pubcommand.com/f/<form>/results: the live tally, aggregates only. No sign-in. */
export default async function PublicResultsPage({ params }: { params: Params }) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { theme, results } = loaded;
  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      {loaded.open ? <AutoRefresh everyMs={REFRESH_MS} /> : null}
      <FormHeader theme={theme} />
      <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <div className="rounded-xl border border-[#e1e4ea] bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5b6577]">{loaded.open ? "Live results" : "Final results"}</p>
          <h1 className="[overflow-wrap:anywhere] mt-1 text-2xl font-semibold tracking-tight text-[#0b1220]">{loaded.title}</h1>
          {!results.available ? (
            <p className="mt-4 text-sm text-[#3e4a5c]">
              Results appear once {results.minResponses} people have answered{results.total ? ` (${results.total} so far)` : ""}.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-[#5b6577]">
                {results.total} response{results.total === 1 ? "" : "s"}
                {loaded.open ? " · updates by itself" : ""}
              </p>
              {results.questions.length === 0 ? <p className="mt-4 text-sm text-[#3e4a5c]">This form has no questions with results to show.</p> : null}
              <div className="mt-5 space-y-6">
                {results.questions.map((question) => (
                  <section key={question.fieldId} className="min-w-0">
                    <h2 className="[overflow-wrap:anywhere] text-[15px] font-semibold text-[#0b1220]">{question.label || "Question"}</h2>
                    <p className="text-xs text-[#5b6577]">
                      {question.answered} answered{question.kind === "bars" && question.average !== null ? ` · average ${question.average}` : ""}
                    </p>
                    {question.kind === "bars" && question.buckets.length ? <Bars buckets={question.buckets} accent={theme.accentColor} /> : null}
                    {question.kind === "grid"
                      ? question.rows.map((row) => (
                          <div key={row.label} className="mt-3">
                            <p className="[overflow-wrap:anywhere] text-sm font-medium text-[#0b1220]">{row.label}</p>
                            <Bars buckets={row.buckets} accent={theme.accentColor} />
                          </div>
                        ))
                      : null}
                    {question.kind === "ranking" ? (
                      <ol className="mt-2 space-y-1.5">
                        {question.items.map((item, index) => (
                          <li key={item.label} className="flex items-center gap-3 rounded-md border border-[#e1e4ea] px-3 py-2 text-sm">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: theme.accentColor, color: contrastText(theme.accentColor) }}>
                              {index + 1}
                            </span>
                            <span className="[overflow-wrap:anywhere] min-w-0 flex-1 text-[#0b1220]">{item.label}</span>
                            <span className="shrink-0 text-xs tabular-nums text-[#5b6577]">avg {item.meanRank}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-[#5b6577]">
          Totals only. Names, contact details and written answers are never shown.{" "}
          {theme.privacyPolicyUrl ? (
            <a href={theme.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
              Privacy policy
            </a>
          ) : null}
        </p>
      </main>
    </div>
  );
}
