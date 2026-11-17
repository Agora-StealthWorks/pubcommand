import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteCall, deleteCallFile, refreshCall } from "@/features/trackrecord/actions";
import { CallForm } from "@/features/trackrecord/call-form";
import { trackAccess } from "@/features/trackrecord/context";
import { marketConnected } from "@/features/trackrecord/prices";
import { callViews } from "@/features/trackrecord/server";
import { GainText, MarketBanner, PriceNote, iso } from "@/features/trackrecord/ui";
import { FILE_ROLE_LABELS, GAIN_BASIS_LABELS, inlineMime, type FileRole } from "../../../../../../../../../../modules/performance/archive";
import { formatPct, formatPrice } from "../../../../../../../../../../modules/performance/gain";

export default async function CallPage({ params, searchParams }: { params: Promise<{ slug: string; callId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, callId } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  if (!/^[0-9a-f-]{36}$/i.test(callId)) notFound();
  const db = tenantDb(scope.organizationId);
  const row = await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null }, include: { expert: { select: { name: true } } } });
  if (!row) notFound();
  const [view] = await callViews(scope.organizationId, [row], { refresh: true });
  if (!view) notFound();
  const [files, experts, categories] = await Promise.all([
    db.trackCallFile.findMany({ where: { callId: row.id }, select: { id: true, filename: true, mimeType: true, size: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.trackCategory.findMany({ where: { brandId: scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  const gain = view.gain;
  const tags = categories.filter((c) => row.categoryIds.includes(c.id));

  return (
    <div className="max-w-4xl space-y-4">
      <Link href={`/performance/archive?expert=${row.expertId}`} className="text-sm text-accent">
        ← {view.expertName}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {view.expertName} · {row.callType} · {iso(row.callDate)}
          </p>
          <h2 className="break-words text-xl font-semibold">{row.title}</h2>
          <p className="text-sm text-muted">
            {row.ticker ?? "No ticker"} · {row.direction === "SHORT" ? "Short" : "Long"}
            {row.source ? ` · ${row.source}` : ""}
          </p>
          {tags.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} aria-hidden />
                  {c.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <GainText pct={gain.pct} className="text-2xl" />
          <span className="block text-xs text-muted">{GAIN_BASIS_LABELS[row.gainBasis as keyof typeof GAIN_BASIS_LABELS] ?? row.gainBasis}</span>
          <PriceNote gain={gain} />
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      {row.gainBasis !== "EXIT" && row.gainBasis !== "NONE" ? <MarketBanner connected={marketConnected()} staleCount={gain.stale ? 1 : 0} /> : null}
      <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Entry</dt>
          <dd className="tabular-nums">{formatPrice(row.entryPrice)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Measured to</dt>
          <dd className="tabular-nums">
            {formatPrice(gain.current)} {gain.currentAt ? <span className="text-xs text-muted">{iso(gain.currentAt)}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Best since the call</dt>
          <dd className="tabular-nums">{gain.peak ? `${formatPrice(gain.peak.price)} (${formatPct(gain.peak.pct)})` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">$1,000 became</dt>
          <dd className="tabular-nums">{gain.pct == null ? "—" : `$${Math.round(1000 * (1 + gain.pct / 100)).toLocaleString("en-US")}`}</dd>
        </div>
      </dl>
      {gain.splitNote || row.splitSource === "unknown" ? (
        <p className="text-sm text-muted">{gain.splitNote ?? "The entry price does not match the market close on the call date. Check the backup or set the split."}</p>
      ) : null}
      {row.keyQuote ? <blockquote className="whitespace-pre-wrap rounded-xl border-l-4 border-accent bg-white p-4 text-sm">{row.keyQuote}</blockquote> : null}
      {row.notes ? <p className="whitespace-pre-wrap rounded-xl border border-line bg-white p-4 text-sm">{row.notes}</p> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Backup · {files.length}</h3>
        {files.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">No backup files yet.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => {
            const href = `/performance/archive/${row.id}/files/${file.id}`;
            return (
              <figure key={file.id} className="min-w-0 rounded-xl border border-line bg-white p-3">
                {file.mimeType.startsWith("image/") && inlineMime(file.mimeType) ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    <img src={href} alt={file.filename} className="max-h-72 w-full rounded-md object-contain" />
                  </a>
                ) : file.mimeType.startsWith("video/") && inlineMime(file.mimeType) ? (
                  <video src={href} controls preload="metadata" className="max-h-72 w-full rounded-md" />
                ) : null}
                <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <a href={href} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-accent">
                    {file.filename}
                  </a>
                  <span className="text-muted">
                    {FILE_ROLE_LABELS[file.role as FileRole] ?? file.role} · {Math.max(1, Math.round(file.size / 1024))} KB
                  </span>
                </figcaption>
                {scope.canWrite ? (
                  <form action={deleteCallFile} className="mt-2">
                    <input type="hidden" name="callId" value={row.id} />
                    <input type="hidden" name="fileId" value={file.id} />
                    <button type="submit" className="text-xs font-semibold text-[#b42318]">
                      Remove file
                    </button>
                  </form>
                ) : null}
              </figure>
            );
          })}
        </div>
      </section>

      {scope.canWrite ? (
        <>
          <div className="flex flex-wrap gap-2">
            <form action={refreshCall}>
              <input type="hidden" name="callId" value={row.id} />
              <Button type="submit" variant="secondary" size="sm">
                Refresh prices
              </Button>
            </form>
          </div>
          <h3 className="text-sm font-semibold">Edit</h3>
          <CallForm call={row} experts={experts} categories={categories} />
          <form action={deleteCall} className="rounded-xl border border-[#fecdca] bg-white p-4">
            <input type="hidden" name="callId" value={row.id} />
            <Button type="submit" variant="danger">
              Delete call
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}
