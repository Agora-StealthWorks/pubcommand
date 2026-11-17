import { tenantDb } from "@pubcommand/db";
import { Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { fmtDate } from "@/features/support/data";
import { supportPage } from "@/features/support/guard";
import { searchKnowledge } from "@/features/support/search";
import { AudienceBadge, Empty, StatusBadge, categoryLabel, sourceLabel } from "@/features/support/ui";
import { toPlain } from "../../../../../../../../modules/support/records";
import { CATEGORIES, RECORD_CATEGORIES, isAudience, isRecordCategory, isStatus } from "../../../../../../../../modules/support/taxonomy";

type Search = { error?: string; notice?: string; category?: string; audience?: string; status?: string; q?: string };

export default async function SupportRecordsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const category = isRecordCategory(query.category) ? query.category : null;
  const audience = isAudience(query.audience) ? query.audience : null;
  const status = isStatus(query.status) ? query.status : null;
  const q = (query.q ?? "").trim().slice(0, 200);

  let ids: string[] | null = null;
  if (q) {
    const hits = await searchKnowledge(
      { organizationId: ctx.resolved.id, brandId: ctx.brand.id, scope: { categories: category ? [category] : RECORD_CATEGORIES, audiences: audience ? [audience] : ["public", "member"] } },
      q,
      { k: 20, includeDrafts: true },
    );
    ids = [...new Set(hits.map((h) => h.recordId))];
  }
  const where = {
    brandId: ctx.brand.id,
    ...(category ? { category } : {}),
    ...(audience ? { audience } : {}),
    ...(status ? { status } : { status: { not: "archived" } }),
    ...(ids ? { id: { in: ids } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.supportRecord.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: { id: true, title: true, category: true, audience: true, status: true, source: true, locked: true, gateHits: true, updatedAt: true, summary: true, body: true, priceConfirmedAt: true },
    }),
    db.supportRecord.count({ where }),
  ]);
  const ordered = ids ? ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => Boolean(r)) : rows;

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <form className="grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,160px))_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search records" aria-label="Search records" />
        <select name="category" defaultValue={category ?? ""} className="pc-control w-full" aria-label="Category">
          <option value="">All categories</option>
          {RECORD_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {CATEGORIES[key].label}
            </option>
          ))}
        </select>
        <select name="audience" defaultValue={audience ?? ""} className="pc-control w-full" aria-label="Audience">
          <option value="">Public and members</option>
          <option value="public">Public</option>
          <option value="member">Members only</option>
        </select>
        <select name="status" defaultValue={status ?? ""} className="pc-control w-full" aria-label="Status">
          <option value="">Published and drafts</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="archived">Archived</option>
        </select>
        <button className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">Filter</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {total} record{total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""}
        </p>
        {ctx.canWrite ? (
          <Link href="/support/records/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
            + New record
          </Link>
        ) : null}
      </div>

      {ordered.length ? (
        <ul className="space-y-2">
          {ordered.map((r) => (
            <li key={r.id} className="min-w-0">
              <Link href={`/support/records/${r.id}`} className="block min-w-0 rounded-xl border border-line bg-white p-4 hover:border-accent">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{r.title}</span>
                  <StatusBadge status={r.status} />
                  <AudienceBadge audience={r.audience} />
                  {r.gateHits.length ? <span className="rounded-full bg-[#fee4e2] px-2 py-0.5 text-xs font-semibold text-[#b42318]">Gate: {r.gateHits.length}</span> : null}
                  {r.category === "pricing" && !r.priceConfirmedAt ? <span className="rounded-full bg-[#fef0c7] px-2 py-0.5 text-xs font-semibold text-[#b54708]">Price unconfirmed</span> : null}
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-muted [overflow-wrap:anywhere]">{r.summary || toPlain(r.body).slice(0, 220)}</span>
                <span className="mt-2 block text-xs text-muted">
                  {categoryLabel(r.category)} · {sourceLabel(r.source)}
                  {r.locked ? " · edited here (sync skips it)" : ""} · {fmtDate(r.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {q || category || audience || status
            ? "Nothing matches these filters."
            : `No records yet. Add answers by hand, or pull publications and editors from Publication Setup on the Sources tab.`}
        </Empty>
      )}
    </div>
  );
}
