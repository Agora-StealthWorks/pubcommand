import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { marketConnected } from "@/features/trackrecord/prices";
import { callViews } from "@/features/trackrecord/server";
import { GainText, MarketBanner, PriceNote, iso } from "@/features/trackrecord/ui";
import { archiveMode } from "../../../../../../../../../modules/performance/archive";

export default async function ArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ expert?: string; q?: string; category?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const db = tenantDb(scope.organizationId);
  const [experts, categories] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.trackCategory.findMany({ where: { brandId: scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const mode = archiveMode(query);
  const category = categories.find((c) => c.id === query.category) ?? null;
  const categoryName = new Map(categories.map((c) => [c.id, c]));
  const rows =
    mode.kind === "none"
      ? []
      : await db.trackCall.findMany({
          where: {
            brandId: scope.brandId,
            deletedAt: null,
            ...(mode.kind === "expert" ? { expertId: mode.expertId } : { OR: [{ ticker: mode.ticker }, { priceSymbol: mode.ticker }] }),
            ...(category ? { categoryIds: { has: category.id } } : {}),
          },
          include: { expert: { select: { name: true } } },
          orderBy: [{ callDate: "desc" }, { createdAt: "desc" }],
          take: 500,
        });
  const views = await callViews(scope.organizationId, rows, { refresh: true });
  const expert = mode.kind === "expert" ? experts.find((e) => e.id === mode.expertId) : null;
  const base = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
    const text = params.toString();
    return `/performance/archive${text ? `?${text}` : ""}`;
  };
  const modeParams = mode.kind === "expert" ? { expert: mode.expertId } : mode.kind === "ticker" ? { q: mode.ticker } : {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Documented calls by expert, with the original backup and a gain recalculated from real prices.</p>
        {scope.canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/performance/archive/manage" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
              Experts and categories
            </Link>
            <Link href="/performance/archive/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
              + Add a call
            </Link>
          </div>
        ) : null}
      </div>
      <Flash error={query.error} notice={query.notice} />
      <form action="/performance/archive" className="flex flex-wrap gap-2 rounded-xl border border-line bg-white p-3">
        <input
          name="q"
          defaultValue={mode.kind === "ticker" ? mode.ticker : ""}
          placeholder="Search a ticker across every expert"
          aria-label="Ticker"
          className="pc-control min-w-0 flex-1 uppercase"
        />
        <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-2" aria-label="Experts">
        {experts.map((e) => (
          <Link
            key={e.id}
            href={base({ expert: e.id, category: category?.id })}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${mode.kind === "expert" && mode.expertId === e.id ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {e.name}
          </Link>
        ))}
        {experts.length === 0 ? <p className="text-sm text-muted">No experts yet. {scope.canWrite ? "Add one under Experts and categories." : ""}</p> : null}
      </div>
      {mode.kind !== "none" && categories.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Categories">
          <Link href={base(modeParams)} className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${!category ? "border-ink" : "border-line bg-white"}`}>
            All categories
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={base({ ...modeParams, category: c.id })}
              title={c.description || undefined}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${category?.id === c.id ? "border-ink" : "border-line bg-white"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden />
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}

      {mode.kind === "none" ? (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-sm text-muted">Pick an expert or search a ticker to see calls.</p>
      ) : (
        <>
          <MarketBanner connected={marketConnected()} staleCount={views.filter((v) => v.gain.stale).length} />
          <h2 className="text-sm font-semibold">
            {mode.kind === "expert" ? `${expert?.name ?? "Expert"} · ${views.length} call${views.length === 1 ? "" : "s"}` : `${mode.ticker} across every expert · ${views.length}`}
            {category ? ` · ${category.name}` : ""}
          </h2>
          {views.length === 0 ? (
            <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">No calls match.</p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {mode.kind === "ticker" ? <th className="px-3 py-2">Expert</th> : null}
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Call</th>
                    {mode.kind === "expert" ? <th className="px-3 py-2">Ticker</th> : null}
                    <th className="px-3 py-2">Categories</th>
                    <th className="px-3 py-2 text-right">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {views.map((v) => (
                    <tr key={v.id} className="border-t border-line align-top">
                      {mode.kind === "ticker" ? <td className="px-3 py-2 font-semibold">{v.expertName}</td> : null}
                      <td className="px-3 py-2 tabular-nums">{iso(v.callDate)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/performance/archive/${v.id}`} className="font-semibold text-accent">
                          {v.title}
                        </Link>
                        <span className="block text-xs text-muted">
                          {v.callType} · {v.direction === "SHORT" ? "Short" : "Long"}
                        </span>
                      </td>
                      {mode.kind === "expert" ? <td className="px-3 py-2 font-semibold">{v.ticker ?? "—"}</td> : null}
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {v.categoryIds.map((id) => categoryName.get(id)).filter(Boolean).map((c) => (
                            <span key={c!.id} className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-xs">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c!.color }} aria-hidden />
                              {c!.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <GainText pct={v.gain.pct} />
                        <PriceNote gain={v.gain} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </>
      )}
    </div>
  );
}
