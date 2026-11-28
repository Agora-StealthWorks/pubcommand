import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { canUsePromoAnalyzer } from "@/features/intel/context";
import { analyzerPromoFor } from "@/features/ispy/analyzer";
import { AnalyzerPanel, ReportPanel } from "@/features/ispy/org-blocks";
import { deepAnalyzeIspyAction } from "@/features/ispy/org-actions";
import { UUID, ispyOrgScope, qs, searchDuplicateTargets } from "@/features/ispy/org-data";
import { IspyTypeBadge, KindBadge, formatDay, shortDay } from "@/features/ispy/org-ui";
import { getCopy } from "@/features/ispy/read";
import { offerLine } from "../../../../../../../../../../modules/ispy/index";

const MATCH_LABEL: Record<string, string> = { new: "first seen", exact: "exact copy", near: "near match", campaign: "same campaign ID", merged: "merged by staff" };

/** Sends per week, oldest to newest, for the sparkline. */
function weekly(dates: Date[]): number[] {
  if (!dates.length) return [];
  const start = dates[0]!.getTime();
  const weeks = Math.min(26, Math.floor((dates[dates.length - 1]!.getTime() - start) / (7 * 86_400_000)) + 1);
  const out = new Array<number>(weeks).fill(0);
  for (const d of dates) out[Math.min(weeks - 1, Math.floor((d.getTime() - start) / (7 * 86_400_000)))]! += 1;
  return out;
}

export default async function IspyCopyPage({ params, searchParams }: { params: Promise<{ slug: string; copyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, copyId } = await params;
  const search = await searchParams;
  if (!UUID.test(copyId)) notFound();
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, scope } = found.value;
  const data = await getCopy(viewer, copyId);
  if (!data) notFound();
  const { copy, sends, promo, text } = data;
  const feedParam = search.feed;
  const back = `/intel/copies/${copy.id}${qs({ feed: feedParam, tab: search.tab })}`;
  const [allowed, existing, dupResults] = await Promise.all([
    canUsePromoAnalyzer(slug),
    analyzerPromoFor(scope.organizationId, "COPY", copy.id),
    search.dupq ? searchDuplicateTargets(viewer, "COPY", search.dupq, copy.id) : Promise.resolve([]),
  ]);
  const dates = sends.map((s) => s.receivedAt);
  const spark = weekly(dates);
  const max = Math.max(1, ...spark);
  const days = dates.length > 1 ? Math.round((dates[dates.length - 1]!.getTime() - dates[0]!.getTime()) / 86_400_000) : 0;
  const lists = new Set(sends.map((s) => s.list).filter(Boolean)).size;
  const affiliates = new Set(sends.filter((s) => s.kind === "AFFILIATE").map((s) => s.list)).size;
  const kindsSeen = new Set(sends.map((s) => s.kind));
  const tab = search.tab === "copy" || search.tab === "note" ? search.tab : "sum";
  const x = copy.extraction;
  const offer = x ? offerLine(x.offer) : null;
  const tabHref = (t: string) => `/intel/copies/${copy.id}${qs({ feed: feedParam, tab: t === "sum" ? undefined : t })}`;

  return (
    <div className="min-w-0">
      <Link href={`/intel${qs({ feed: feedParam })}`} className="text-sm text-accent underline">
        ← Feed
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div className="min-w-0 flex-[1_1_480px]">
          <div className="flex flex-wrap gap-2">
            <IspyTypeBadge type={copy.emailType} />
            {sends.length > 1 ? <span className="rounded-full bg-[#fff1c2] px-2 py-0.5 text-xs font-semibold text-[#6b4700]">↻ sent {sends.length}× · {copy.subjectCount} subject{copy.subjectCount === 1 ? "" : "s"}</span> : null}
            {kindsSeen.has("AFFILIATE") && copy.firstSeenKind !== "AFFILIATE" ? <span className="rounded-full bg-[#ebe3ff] px-2 py-0.5 text-xs font-semibold text-[#44238f]">moved {copy.firstSeenKind.toLowerCase()} → affiliate</span> : null}
          </div>
          <h2 className="pc-break mt-2 text-xl font-semibold tracking-tight text-ink">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted">
            One email body, matched whatever its subject.
            {promo ? (
              <>
                {" "}
                Advertiser <strong className="text-ink">{promo.advertiserLabel ?? promo.advertiser.label}</strong> ·{" "}
                <Link href={`/intel/promos/${promo.id}${qs({ feed: feedParam })}`} className="text-accent underline">
                  Promo: {promo.headline ?? "open"}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {promo ? (
            <Link href={`/intel/promos/${promo.id}${qs({ feed: feedParam })}`} className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
              Open promo
            </Link>
          ) : null}
          <AnalyzerPanel targetType="COPY" targetId={copy.id} feed={copy.feed} back={back} existingPromoId={existing} allowed={allowed} />
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_600px] overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b border-line p-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">First sent</div>
              <div className="font-semibold text-ink">
                {formatDay(sends[0]!.receivedAt)} · {sends[0]!.kind.toLowerCase()}
                {sends[0]!.list ? ` on ${sends[0]!.list}` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">Sends</div>
              <div className="font-semibold text-ink">
                {sends.length} in {days} day{days === 1 ? "" : "s"}
                {sends.length > 1 ? ` · every ~${Math.max(1, Math.round(days / (sends.length - 1)))} days` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">Lists</div>
              <div className="font-semibold text-ink">
                {lists} list{lists === 1 ? "" : "s"} · {affiliates} affiliate{affiliates === 1 ? "" : "s"}
              </div>
            </div>
            {spark.length > 1 ? (
              <figure className="m-0">
                <figcaption className="text-xs font-bold uppercase tracking-wide text-muted">Sends per week</figcaption>
                <svg width={Math.min(260, spark.length * 14)} height="32" role="img" aria-label={`Sends per week: ${spark.join(", ")}`}>
                  {spark.map((n, i) => (
                    <rect key={i} x={i * 14} y={32 - Math.max(2, (n / max) * 30)} width="10" height={Math.max(2, (n / max) * 30)} rx="2" fill={n ? "#1d4ed8" : "#c9d1de"} />
                  ))}
                </svg>
              </figure>
            ) : null}
          </div>

          <h3 className="px-4 pb-1 pt-4 text-sm font-semibold text-ink">Send timeline</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[96px]" />
                <col className="w-[200px]" />
                <col className="w-[104px]" />
                <col />
                <col className="w-[130px]" />
              </colgroup>
              <thead className="border-y border-line bg-[#fafbfc] text-left text-xs font-bold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2">List</th>
                  <th scope="col" className="px-3 py-2">Kind</th>
                  <th scope="col" className="px-3 py-2">Subject</th>
                  <th scope="col" className="px-3 py-2">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sends.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2 text-xs text-muted">{shortDay(s.receivedAt)}</td>
                    <td className="pc-break px-3 py-2">
                      {s.list ?? "—"}
                      {s.publisher ? <span className="block text-xs text-muted">{s.publisher}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <KindBadge kind={s.kind} />
                    </td>
                    <td className="pc-break px-3 py-2">
                      <Link href={`/intel/mail/${s.id}${qs({ feed: feedParam })}`} className="text-ink hover:underline">
                        “{s.subject}”
                      </Link>
                      {s.newSubject ? <span className="ml-1 rounded-full bg-[#fff1c2] px-2 py-0.5 text-xs font-semibold text-[#6b4700]">new subject</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{MATCH_LABEL[s.match ?? "new"] ?? s.match}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Copy details" className="mt-2 flex flex-wrap gap-1 border-y border-line px-2">
            {[
              ["sum", "What it says"],
              ["copy", "Email copy"],
              ["note", "Brain note"],
            ].map(([key, label]) => (
              <Link key={key} href={tabHref(key!)} className={`-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-bold ${tab === key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                {label}
              </Link>
            ))}
          </nav>
          {tab === "sum" ? (
            x ? (
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold text-ink">Key takeaways</h4>
                  {x.takeaways.length ? (
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                      {x.takeaways.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">None recorded.</p>
                  )}
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <h4 className="font-semibold text-ink">Offer</h4>
                    <p className="text-ink">{offer ?? "No offer stated."}</p>
                  </div>
                  {x.topics.length ? (
                    <div>
                      <h4 className="font-semibold text-ink">Topics</h4>
                      <p className="flex flex-wrap gap-1">
                        {x.topics.map((t) => (
                          <span key={t} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink">
                            {t}
                          </span>
                        ))}
                      </p>
                    </div>
                  ) : null}
                  {x.gurus.length ? <p className="text-ink">Gurus: {x.gurus.join(", ")}</p> : null}
                  {x.promotedBrand ? (
                    <p className="text-ink">
                      Promotes: {x.promotedBrand}
                      {x.promotedGuru ? ` (${x.promotedGuru})` : ""}
                      {x.hasEdNote ? " · with an editor's note" : ""}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">Read once when this copy was first seen. Re-sends reuse it, with no extra AI cost.</p>
                </div>
              </div>
            ) : (
              <p className="p-4 text-sm text-muted">{copy.extractionStatus === "QUEUED" || copy.extractionStatus === "RUNNING" ? "Being read now." : copy.extractionError ?? "Not read yet."}</p>
            )
          ) : null}
          {tab === "copy" ? <pre className="pc-break max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 font-sans text-sm text-ink">{text}</pre> : null}
          {tab === "note" ? (
            <div className="p-4">
              <p className="text-sm text-muted">
                Each copy is one note: in your Brain when it&apos;s from your own publications, otherwise in PubCommand&apos;s Master Brain under ISpy/. It updates itself as new sends arrive.
              </p>
            </div>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <h3 className="font-semibold text-ink">How it was matched</h3>
            <p className="mt-1 text-muted">Same body text after the greeting, names, tracking links, dates and footer are stripped. The subject is ignored.</p>
            <ul className="mt-2 space-y-1 text-ink">
              {Object.entries(
                sends.reduce<Record<string, number>>((acc, s) => {
                  const key = MATCH_LABEL[s.match ?? "new"] ?? s.match ?? "first seen";
                  acc[key] = (acc[key] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([label, n]) => (
                <li key={label}>
                  {label}: <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </div>
          {scope.canWrite ? (
            <form action={deepAnalyzeIspyAction} className="rounded-xl border border-line bg-white p-4 text-sm">
              <input type="hidden" name="copyId" value={copy.id} />
              <input type="hidden" name="feed" value={copy.feed} />
              <input type="hidden" name="back" value={back} />
              <p className="text-muted">Compliance risk, hook, proof and what works, in one bigger AI call. Run only when you need it.</p>
              <button type="submit" className="mt-2 inline-flex min-h-9 items-center rounded-md border border-line px-3 font-semibold hover:bg-canvas">{copy.deepAnalysis ? "Re-run deep analysis" : "Deep analyze"}</button>
            </form>
          ) : null}
          {copy.deepAnalysis ? (
            <div className="rounded-xl border border-line bg-white p-4 text-sm">
              <h3 className="font-semibold text-ink">Deep analysis</h3>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-ink">{JSON.stringify(copy.deepAnalysis, null, 2)}</pre>
            </div>
          ) : null}
          <ReportPanel targetType="COPY" targetId={copy.id} feed={copy.feed} back={back} canWrite={scope.canWrite} dupKind="COPY" dupQuery={search.dupq ?? ""} dupResults={dupResults} />
        </aside>
      </div>
    </div>
  );
}
