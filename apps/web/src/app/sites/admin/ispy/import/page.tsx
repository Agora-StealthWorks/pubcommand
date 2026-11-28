import { Flash } from "@/components/ui";
import { requestImport } from "@/features/ispy/console-actions";
import { Back, btn, btnPrimary, card, Pill, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";
import type { ImportReport } from "@/features/ispy/import-legacy";

export const metadata = { title: "ISpy · Import" };

/** One-time import of the old iSpy Finpub database into the FinPub feed. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const [request, reportRow] = await ispyDb((tx) => Promise.all([tx.ispySetting.findUnique({ where: { key: "import_request" } }), tx.ispySetting.findUnique({ where: { key: "import_report" } })]));
  const report = (reportRow?.value ?? null) as (Partial<ImportReport> & { running?: boolean }) | null;
  const configured = Boolean(process.env.ISPY_LEGACY_DATABASE_URL);
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div>
        <h2 className="text-lg font-semibold">Import from iSpy</h2>
        <p className="max-w-3xl text-sm text-muted">Reads the old iSpy database (read only) into the FinPub feed: publishers, lists (grouped into publications), gurus, topics, the Gmail inboxes with their tokens, emails with their classifications, promos, sightings and blocks. Safe to run again: rows already imported are skipped. No AI is used; old lift notes are split into internal and external lifts.</p>
      </div>
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Source</span>
          <code>ISPY_LEGACY_DATABASE_URL</code>
          {configured ? <Pill tone="ok">set</Pill> : <Pill tone="warn">not set on this server</Pill>}
          {request ? <Pill tone="warn">queued: starts within 5 minutes</Pill> : null}
          {report?.running ? <Pill tone="blue">running since {String(report.startedAt ?? "").slice(0, 16).replace("T", " ")}</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={requestImport}>
            <Back to="/ispy/import" />
            <input type="hidden" name="apply" value="false" />
            <button className={btn} type="submit" disabled={!configured}>Dry run</button>
          </form>
          <form action={requestImport}>
            <Back to="/ispy/import" />
            <input type="hidden" name="apply" value="true" />
            <button className={btnPrimary} type="submit" disabled={!configured}>Import</button>
          </form>
        </div>
      </section>
      {report && !report.running ? (
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="text-base font-semibold">Last {report.dryRun ? "dry run" : "import"}</h3>
            <span className="text-sm text-muted">{String(report.startedAt ?? "").slice(0, 16).replace("T", " ")} → {String(report.finishedAt ?? "").slice(0, 16).replace("T", " ")}</span>
            {report.error ? <Pill tone="red">{report.error}</Pill> : <Pill tone="ok">finished</Pill>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead className="bg-[#fafbfc]">
                <tr>
                  <th scope="col" className={th}>What</th>
                  <th scope="col" className={`${th} text-right`}>In iSpy</th>
                  <th scope="col" className={`${th} text-right`}>{report.dryRun ? "Would add" : "Added"}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.counts ?? {}).map(([name, c]) => (
                  <tr key={name} className="border-t border-line">
                    <td className={td}>{name}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.source}</td>
                    <td className={`${td} text-right tabular-nums`}>{report.dryRun ? "—" : c.added}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.notes?.length ? (
            <ul className="list-disc px-8 py-3 text-sm text-muted">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
