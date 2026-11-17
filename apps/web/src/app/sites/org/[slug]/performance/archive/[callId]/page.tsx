import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteCall, deleteCallFile, dismissProposal, markPricesChecked, readCallBackups, refreshCall } from "@/features/trackrecord/actions";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { CallForm } from "@/features/trackrecord/call-form";
import { trackAccess } from "@/features/trackrecord/context";
import { marketConnected } from "@/features/trackrecord/prices";
import { callViews } from "@/features/trackrecord/server";
import { GainText, MarketBanner, PriceNote, iso } from "@/features/trackrecord/ui";
import { FILE_ROLE_LABELS, GAIN_BASIS_LABELS, inlineMime, type FileRole } from "../../../../../../../../../../modules/performance/archive";
import { PRICE_FIELD_LABELS, storedProposal, type PriceField } from "../../../../../../../../../../modules/performance/backup-read";
import { formatPct, formatPrice } from "../../../../../../../../../../modules/performance/gain";

export default async function CallPage({ params, searchParams }: { params: Promise<{ slug: string; callId: string }>; searchParams: Promise<{ error?: string; notice?: string; apply?: string }> }) {
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
    db.trackCallFile.findMany({
      where: { callId: row.id },
      select: { id: true, filename: true, mimeType: true, size: true, role: true, createdAt: true, transcript: true, transcriptStatus: true, transcriptError: true },
      orderBy: { createdAt: "asc" },
    }),
    db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.trackCategory.findMany({ where: { brandId: scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  const gain = view.gain;
  const tags = categories.filter((c) => row.categoryIds.includes(c.id));
  const proposal = row.aiStatus === "done" ? storedProposal(row.aiProposal) : null;
  const applying = Boolean(proposal && query.apply === "1" && scope.canWrite);
  const running = row.aiStatus === "running";
  const toCheck = row.priceCheck.filter((f): f is PriceField => f in PRICE_FIELD_LABELS);
  const checkNote = (field: PriceField) => (toCheck.includes(field) ? <span className="block text-xs font-semibold text-[#b54708]">* Read from the document by AI: not checked yet</span> : null);

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
          <dd className="tabular-nums">
            {formatPrice(row.entryPrice)}
            {checkNote("entryPrice")}
          </dd>
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
      {row.targetPrice != null || row.exitPrice != null ? (
        <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Target named in the call</dt>
            <dd className="tabular-nums">
              {formatPrice(row.targetPrice)}
              {checkNote("targetPrice")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Exit</dt>
            <dd className="tabular-nums">
              {formatPrice(row.exitPrice)} {row.exitDate ? <span className="text-xs text-muted">{iso(row.exitDate)}</span> : null}
              {checkNote("exitPrice")}
            </dd>
          </div>
        </dl>
      ) : null}
      {toCheck.length && scope.canWrite ? (
        <form action={markPricesChecked} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fedf89] bg-[#fffaeb] p-3 text-sm text-[#93370d]">
          <input type="hidden" name="callId" value={row.id} />
          <span className="min-w-0">
            {toCheck.map((f) => PRICE_FIELD_LABELS[f]).join(", ")} {toCheck.length === 1 ? "was" : "were"} read from the document by AI. Compare with the backup files below.
          </span>
          <Button type="submit" variant="secondary" size="sm">
            I checked {toCheck.length === 1 ? "it" : "them"}
          </Button>
        </form>
      ) : null}

      {scope.canWrite ? (
        <section className="space-y-3 rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">AI read of the backup</h3>
              <p className="text-xs text-muted">Transcribes the files and proposes the fields. You review the proposal before anything changes; gains still come from market data.</p>
            </div>
            <form action={readCallBackups}>
              <input type="hidden" name="callId" value={row.id} />
              <Button type="submit" variant="secondary" size="sm" disabled={running || files.length === 0}>
                {row.aiStatus === "none" ? "Read backups with AI" : "Read again"}
              </Button>
            </form>
          </div>
          {running ? (
            <p className="text-sm text-muted">
              Reading the backups… <AutoRefresh />
            </p>
          ) : null}
          {row.aiStatus === "unavailable" || row.aiStatus === "failed" ? (
            <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{row.aiError ?? "The AI read failed."}</p>
          ) : null}
          {row.aiStatus === "reviewed" ? <p className="text-sm text-muted">The last proposal was reviewed and saved.</p> : null}
          {proposal ? (
            <div className="space-y-2">
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {(
                  [
                    ["Ticker", proposal.ticker],
                    ["Direction", proposal.direction === "SHORT" ? "Short" : proposal.direction === "LONG" ? "Long" : null],
                    ["Call date", proposal.callDate],
                    ["Type", proposal.callType],
                    ["Entry price", proposal.entryPrice != null ? `${formatPrice(proposal.entryPrice)} *` : null],
                    ["Target", proposal.targetPrice != null ? `${formatPrice(proposal.targetPrice)} *` : null],
                    ["Exit price", proposal.exitPrice != null ? `${formatPrice(proposal.exitPrice)} *` : null],
                    ["Source", proposal.source],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="truncate tabular-nums">{value ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              {proposal.title ? <p className="text-sm"><span className="text-muted">Title:</span> {proposal.title}</p> : null}
              {proposal.keyQuote ? <blockquote className="whitespace-pre-wrap border-l-4 border-line pl-3 text-sm">{proposal.keyQuote}</blockquote> : null}
              {proposal.priceFields.length ? <p className="text-xs font-semibold text-[#b54708]">* Read from the document by AI. Check every price against the backup.</p> : null}
              {proposal.warnings.map((w) => (
                <p key={w} className="text-xs text-[#b54708]">{w}</p>
              ))}
              {proposal.notes ? <p className="text-xs text-muted">{proposal.notes}</p> : null}
              {proposal.evidence.length ? (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-accent">Where each field came from</summary>
                  <ul className="mt-1 space-y-1 text-xs text-muted">
                    {proposal.evidence.map((e, i) => (
                      <li key={`${e.field}-${i}`} className="break-words">
                        {e.field} · file {e.file}: “{e.quote}”
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a href={`/performance/archive/${row.id}?apply=1#edit`} className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
                  Review and apply
                </a>
                <form action={dismissProposal}>
                  <input type="hidden" name="callId" value={row.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Dismiss
                  </Button>
                </form>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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
                {file.transcriptStatus === "done" && file.transcript ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-accent">Transcript</summary>
                    <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-xs">{file.transcript}</p>
                  </details>
                ) : file.transcriptError ? (
                  <p className="mt-2 text-xs text-muted">{file.transcriptError}</p>
                ) : null}
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
          <h3 id="edit" className="text-sm font-semibold">
            {applying ? "Review the AI proposal" : "Edit"}
          </h3>
          <CallForm call={row} experts={experts} categories={categories} proposal={applying ? proposal : null} />
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
