import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { canUsePromoAnalyzer } from "@/features/intel/context";
import { analyzerPromoFor } from "@/features/ispy/analyzer";
import { ripPromoVideoAction } from "@/features/ispy/org-actions";
import { AnalyzerPanel, ReportPanel } from "@/features/ispy/org-blocks";
import { UUID, ispyOrgScope, qs, searchDuplicateTargets } from "@/features/ispy/org-data";
import { KindBadge, PromoKindBadge, TranscriptLine, formatDay, shortDay } from "@/features/ispy/org-ui";
import { getPromo } from "@/features/ispy/read";
import { hostOf } from "../../../../../../../../../../modules/intel/index";

const ALIAS_REASON: Record<string, string> = {
  URL: "Same final page after following the tracking redirects",
  CANONICAL: "The page declares this canonical URL",
  CONTENT: "Same headline on the same domain",
  VIDEO: "Same VSL video on the page",
  MERGE: "Merged by PubCommand staff",
};

export default async function IspyPromoPage({ params, searchParams }: { params: Promise<{ slug: string; promoId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, promoId } = await params;
  const search = await searchParams;
  if (!UUID.test(promoId)) notFound();
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, scope } = found.value;
  const data = await getPromo(viewer, promoId);
  if (!data) notFound();
  const { promo, aliases, landing, sightings, copies } = data;
  const feedParam = search.feed;
  const tab = search.tab === "emails" || search.tab === "timeline" ? search.tab : "landing";
  const back = `/intel/promos/${promo.id}${qs({ feed: feedParam, tab: search.tab })}`;
  const [allowed, existing, dupResults] = await Promise.all([
    canUsePromoAnalyzer(slug),
    analyzerPromoFor(scope.organizationId, "PROMO", promo.id),
    search.dupq ? searchDuplicateTargets(viewer, "PROMO", search.dupq, promo.id) : Promise.resolve([]),
  ]);
  const advertiser = promo.advertiserLabel ?? promo.advertiser.label;
  const lists = new Set(sightings.map((s) => s.list ?? s.publisher).filter(Boolean));
  const affiliates = new Set(sightings.filter((s) => s.sendKind === "AFFILIATE").map((s) => s.publisher ?? s.list));
  const reasons = [...new Set(aliases.map((a) => a.source))];
  const tabHref = (t: string) => `/intel/promos/${promo.id}${qs({ feed: feedParam, tab: t === "landing" ? undefined : t })}`;
  const excerpt = (landing?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);

  return (
    <div className="min-w-0">
      <Link href={`/intel/promos${qs({ feed: feedParam })}`} className="text-sm text-accent underline">
        ← Promo Radar
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div className="min-w-0 flex-[1_1_480px]">
          <div className="flex flex-wrap gap-2">
            <PromoKindBadge kind={promo.kind} />
            {promo.isInternal ? <span className="rounded-full bg-[#d3f0eb] px-2 py-0.5 text-xs font-semibold text-[#0b5248]">internal advertiser</span> : null}
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">first seen {formatDay(promo.firstSeenOn)}</span>
          </div>
          <h2 className="pc-break mt-2 text-xl font-semibold tracking-tight text-ink">{promo.headline ?? promo.landingUrl}</h2>
          <p className="mt-1 text-sm text-muted">
            Advertiser <strong className="text-ink">{advertiser}</strong> · running {promo.daysDetected} day{promo.daysDetected === 1 ? "" : "s"} · {promo.sendCount} send{promo.sendCount === 1 ? "" : "s"} · {lists.size} list{lists.size === 1 ? "" : "s"} · {affiliates.size} affiliate{affiliates.size === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope.canWrite ? (
            <form action={ripPromoVideoAction}>
              <input type="hidden" name="promoId" value={promo.id} />
              <input type="hidden" name="feed" value={promo.feed} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                Rip video → transcript
              </button>
            </form>
          ) : null}
          <AnalyzerPanel targetType="PROMO" targetId={promo.id} feed={promo.feed} back={back} existingPromoId={existing} allowed={allowed} />
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_600px] overflow-hidden rounded-xl border border-line bg-white">
          <nav aria-label="Promo" className="flex flex-wrap gap-1 border-b border-line px-2">
            {[
              ["landing", "Landing page"],
              ["emails", `Emails (${sightings.length})`],
              ["timeline", "Timeline"],
            ].map(([key, label]) => (
              <Link key={key} href={tabHref(key!)} className={`-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-bold ${tab === key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                {label}
              </Link>
            ))}
          </nav>
          {tab === "landing" ? (
            <div className="space-y-4 p-4">
              <TranscriptLine status={landing?.transcriptStatus ?? null} url={landing?.transcriptUrl ?? null} text={landing?.transcriptLinkText ?? null} />
              <div className="overflow-hidden rounded-lg border border-line">
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f2f4f7] px-3 py-2">
                  <a href={promo.landingUrl} target="_blank" rel="noopener noreferrer nofollow" className="pc-break min-w-0 flex-1 text-xs text-accent underline">
                    {promo.landingUrl}
                  </a>
                  {landing ? <span className="text-xs text-muted">Snapshot {formatDay(landing.fetchedAt)} · scripts off</span> : null}
                </div>
                {landing?.snapshotKey ? (
                  <iframe title="Landing page snapshot" src={`/intel/promos/${promo.id}/snapshot${qs({ feed: feedParam })}`} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="h-[60vh] w-full bg-white" />
                ) : (
                  <div className="space-y-2 bg-white p-4">
                    {landing?.headline ? <p className="text-lg font-bold text-ink">{landing.headline}</p> : null}
                    <p className="pc-break whitespace-pre-wrap text-sm text-ink">{excerpt || "The page could not be read (it may be gated or expired); ISpy kept its address."}</p>
                    {(landing?.text?.length ?? 0) > 1200 ? <p className="text-xs text-muted">Showing the first part of the page text.</p> : null}
                  </div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="text-sm">
                  <h3 className="font-semibold text-ink">Why ISpy calls this one promo</h3>
                  <ul className="mt-1 space-y-1 text-ink">
                    {reasons.length ? reasons.map((r) => <li key={r}>✓ {ALIAS_REASON[r] ?? r}</li>) : <li className="text-muted">Seen at one address so far.</li>}
                  </ul>
                </div>
                <div className="min-w-0 text-sm">
                  <h3 className="font-semibold text-ink">Also reached by</h3>
                  <ul className="mt-1 space-y-1">
                    {aliases
                      .filter((a) => a.key.startsWith("url:"))
                      .slice(0, 8)
                      .map((a) => (
                        <li key={a.key} className="pc-break">
                          <code className="rounded bg-canvas px-1 text-xs">{a.key.slice(4)}</code>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
          {tab === "emails" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[84px]" />
                  <col className="w-[104px]" />
                  <col className="w-[200px]" />
                  <col />
                </colgroup>
                <thead className="border-b border-line bg-[#fafbfc] text-left text-xs font-bold uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Date</th>
                    <th scope="col" className="px-3 py-2">Kind</th>
                    <th scope="col" className="px-3 py-2">Sender</th>
                    <th scope="col" className="px-3 py-2">Subject</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sightings
                    .slice()
                    .reverse()
                    .map((s) => (
                      <tr key={s.emailId} className="align-top">
                        <td className="px-3 py-2 text-xs text-muted">{shortDay(s.day)}</td>
                        <td className="px-3 py-2">
                          <KindBadge kind={s.sendKind} />
                        </td>
                        <td className="pc-break px-3 py-2">
                          <span className="font-semibold text-ink">{s.publisher ?? "—"}</span>
                          {s.list ? <span className="block text-xs text-muted">{s.list}</span> : null}
                        </td>
                        <td className="pc-break px-3 py-2">
                          <Link href={`/intel/mail/${s.emailId}${qs({ feed: feedParam })}`} className="text-ink hover:underline">
                            “{s.subject}”
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {tab === "timeline" ? (
            <ol className="space-y-2 p-4 text-sm text-ink">
              {sightings.map((s, i) => (
                <li key={s.emailId}>
                  <strong>{shortDay(s.day)}</strong> — {i === 0 || s.isFirstEver ? "first seen" : s.sendKind === "AFFILIATE" ? "affiliate drop" : "sent"} on {s.list ?? s.publisher ?? "an unsorted list"}
                  {s.publisher && s.list ? ` (${s.publisher})` : ""}.
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <h3 className="font-semibold text-ink">Copies that pushed it</h3>
            {copies.length ? (
              <ul className="mt-2 space-y-1">
                {copies.map((c) => (
                  <li key={c.id}>
                    <Link href={`/intel/copies/${c.id}${qs({ feed: feedParam })}`} className="pc-break text-accent underline">
                      “{c.title}” · {c.sendCount} send{c.sendCount === 1 ? "" : "s"}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted">None recorded.</p>
            )}
          </div>
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <h3 className="font-semibold text-ink">Landing page</h3>
            <p className="pc-break mt-1 text-ink">{hostOf(promo.landingUrl)}</p>
            {promo.videoIds.length ? <p className="mt-1 text-xs text-muted">Video: {promo.videoIds.join(", ")}</p> : null}
            {promo.lastStatus && promo.lastStatus >= 400 ? <p className="mt-1 text-xs text-muted">Last check answered {promo.lastStatus} (gated or expired); the address is still known.</p> : null}
          </div>
          <ReportPanel targetType="PROMO" targetId={promo.id} feed={promo.feed} back={back} canWrite={scope.canWrite} dupKind="PROMO" dupQuery={search.dupq ?? ""} dupResults={dupResults} />
        </aside>
      </div>
    </div>
  );
}
