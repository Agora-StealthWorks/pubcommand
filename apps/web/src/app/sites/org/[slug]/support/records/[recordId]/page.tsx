import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { recordStatusAction, unlockRecordAction } from "@/features/support/actions";
import { fmtDate } from "@/features/support/data";
import { UUID, supportPage } from "@/features/support/guard";
import { RecordForm } from "@/features/support/record-form";
import { AudienceBadge, Section, StatusBadge, categoryLabel, sourceLabel } from "@/features/support/ui";
import { checkContent } from "../../../../../../../../../../modules/support/gate";
import { gateText } from "../../../../../../../../../../modules/support/records";

export default async function SupportRecordPage({ params, searchParams }: { params: Promise<{ slug: string; recordId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, recordId } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing" || !UUID.test(recordId)) notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const record = await db.supportRecord.findFirst({ where: { id: recordId, brandId: ctx.brand.id } });
  if (!record) notFound();
  const [revisions, pubs] = await Promise.all([
    db.supportRevision.findMany({ where: { recordId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, note: true, createdAt: true, snapshot: true } }),
    db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" }, select: { code: true, name: true } }),
  ]);
  const gate = checkContent(gateText(record), record.gateOverrides);
  const meta = (record.meta ?? {}) as Record<string, unknown>;
  const notes = Array.isArray(meta.notes) ? (meta.notes as unknown[]).map(String) : [];

  return (
    <div className="space-y-4">
      <Link href="/support" className="text-sm text-accent">
        ← Records
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{record.title}</h2>
        <StatusBadge status={record.status} />
        <AudienceBadge audience={record.audience} />
      </div>
      <p className="text-sm text-muted">
        {categoryLabel(record.category)} · {sourceLabel(record.source)} · updated {fmtDate(record.updatedAt)}
        {record.category === "pricing" ? (record.priceConfirmedAt ? ` · price confirmed ${fmtDate(record.priceConfirmedAt)}` : " · price not confirmed yet") : ""}
      </p>

      {gate.hits.length ? (
        <div className={`rounded-xl border p-4 text-sm ${gate.ok ? "border-[#fedf89] bg-[#fffaeb]" : "border-[#fecdca] bg-[#fef3f2]"}`}>
          <p className="font-semibold">{gate.ok ? "Content gate: confirmed by a publisher" : "Content gate: cannot be published yet"}</p>
          <ul className="mt-1 list-disc pl-5">
            {gate.hits.map((hit) => (
              <li key={hit.id}>
                {hit.label}: “{hit.match}”{hit.overridable ? (gate.blocking.some((b) => b.id === hit.id) ? " (a publisher may confirm it is public)" : " (confirmed)") : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">Content gate: nothing internal found.</p>
      )}
      {notes.length ? (
        <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">Import notes: {notes.join(" ")}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {ctx.canWrite ? (
            <RecordForm
              canPublish={ctx.canPublish}
              publicationCodes={pubs}
              values={{ ...record, priceConfirmed: Boolean(record.priceConfirmedAt) }}
            />
          ) : (
            <Section title="Answer">
              <p className="whitespace-pre-line break-words text-sm">{record.body}</p>
            </Section>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          {record.source !== "manual" ? (
            <Section title="Source" description={record.locked ? "Edited here, so syncs and imports skip it." : "Kept in step with its source by syncs and imports."}>
              <p className="break-all text-xs text-muted">{record.sourceRef}</p>
              {record.locked && ctx.canPublish ? (
                <form action={unlockRecordAction} className="mt-3">
                  <input type="hidden" name="recordId" value={record.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Unlock: let the source overwrite it
                  </Button>
                </form>
              ) : null}
            </Section>
          ) : null}
          <Section title="Status">
            {record.status !== "archived" && ctx.canPublish ? (
              <form action={recordStatusAction}>
                <input type="hidden" name="recordId" value={record.id} />
                <input type="hidden" name="to" value="archived" />
                <Button type="submit" variant="danger" size="sm">
                  Archive (agents stop using it)
                </Button>
              </form>
            ) : null}
            {record.status === "archived" && ctx.canWrite ? (
              <form action={recordStatusAction}>
                <input type="hidden" name="recordId" value={record.id} />
                <input type="hidden" name="to" value="draft" />
                <Button type="submit" variant="secondary" size="sm">
                  Restore as draft
                </Button>
              </form>
            ) : null}
            {!ctx.canPublish && record.status !== "archived" ? <p className="text-sm text-muted">Publishers can archive it.</p> : null}
          </Section>
          <Section title="History" description="The record as it was before each change.">
            {revisions.length ? (
              <ul className="space-y-2 text-sm">
                {revisions.map((rev) => {
                  const snap = (rev.snapshot ?? {}) as { title?: string; status?: string };
                  return (
                    <li key={rev.id} className="min-w-0 border-b border-line pb-2 last:border-0">
                      <span className="block font-medium [overflow-wrap:anywhere]">{snap.title ?? "(untitled)"}</span>
                      <span className="text-xs text-muted">
                        {fmtDate(rev.createdAt)} · {rev.note} · was {snap.status ?? "?"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No earlier versions.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
