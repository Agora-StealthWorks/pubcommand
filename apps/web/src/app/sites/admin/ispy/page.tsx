import Link from "next/link";
import { Flash } from "@/components/ui";
import { ago, card, Pill, statusTone } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";
import { machineMailConfig } from "@/features/ispy/providers/machinemail";

export const metadata = { title: "ISpy" };

export default async function IspyOverview({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const data = await ispyDb(async (tx) => {
    const [publishers, lists, inboxes, emailsWeek, emailsAll, newPromos, unsorted, candidates, reports, pendingScan, failedScan, problemInboxes, extraction] = await Promise.all([
      tx.ispyPublisher.count({ where: { deletedAt: null } }),
      tx.ispyList.count({ where: { deletedAt: null } }),
      tx.ispyInbox.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.ispyEmail.count({ where: { receivedAt: { gte: since } } }),
      tx.ispyEmail.count(),
      tx.ispyPromo.count({ where: { mergedIntoId: null, firstSeenOn: { gte: since } } }),
      tx.ispyEmail.count({ where: { routeStatus: { in: ["UNSORTED", "CANDIDATE"] } } }),
      tx.ispyListCandidate.count({ where: { status: "PENDING" } }),
      tx.ispyReport.count({ where: { status: "OPEN" } }),
      tx.ispyEmail.count({ where: { promoScanStatus: "PENDING" } }),
      tx.ispyEmail.count({ where: { promoScanStatus: "FAILED" } }),
      tx.ispyInbox.findMany({ where: { OR: [{ status: { in: ["SILENT", "ERROR", "PENDING_SIGNUP"] } }, { lastSyncError: { not: null } }] }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, address: true, status: true, lastMessageAt: true, lastSyncError: true, list: { select: { name: true } } } }),
      tx.ispyCopy.groupBy({ by: ["extractionStatus"], _count: { _all: true } }),
    ]);
    return { publishers, lists, inboxes, emailsWeek, emailsAll, newPromos, unsorted, candidates, reports, pendingScan, failedScan, problemInboxes, extraction };
  });
  const inboxCount = data.inboxes.reduce((n, g) => n + g._count._all, 0);
  const tile = (value: number | string, labelText: string, href?: string) => (
    <div className={`${card} p-4`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted">{href ? <Link href={href} className="hover:underline">{labelText}</Link> : labelText}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <Flash error={query.error} notice={query.notice} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile(data.emailsWeek, "emails this week")}
        {tile(data.newPromos, "new promos this week", "/ispy/promos?sort=first")}
        {tile(data.unsorted, "unsorted emails", "/ispy/inboxes#unsorted")}
        {tile(data.candidates, "new lists to approve", "/ispy/approvals")}
        {tile(data.reports, "open reports", "/ispy/reports")}
        {tile(data.publishers, "publishers", "/ispy/publications")}
        {tile(data.lists, "lists", "/ispy/publications")}
        {tile(inboxCount, "inboxes", "/ispy/inboxes")}
      </div>
      <section className={`${card} p-4`}>
        <h2 className="mb-2 text-base font-semibold">Pipeline</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>Emails stored: <strong>{data.emailsAll}</strong></li>
          <li>Landing pages waiting to be followed: <strong>{data.pendingScan}</strong>{data.failedScan ? <> · failed (retried nightly): <strong>{data.failedScan}</strong></> : null}</li>
          <li>
            Copy extraction (one small AI call per new copy):{" "}
            {data.extraction.map((g) => (
              <span key={g.extractionStatus} className="mr-2">
                {g.extractionStatus.toLowerCase()} <strong>{g._count._all}</strong>
              </span>
            ))}
          </li>
          <li>MachineMail: {machineMailConfig() ? <Pill tone="ok">key set</Pill> : <Pill tone="warn">MACHINEMAIL_API_KEY not set</Pill>}</li>
        </ul>
      </section>
      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold">Inboxes that need attention</h2>
        {data.problemInboxes.length ? (
          <ul className="divide-y divide-line">
            {data.problemInboxes.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <code className="pc-break">{i.address}</code>
                <Pill tone={statusTone(i.status)}>{i.status === "PENDING_SIGNUP" ? "subscribe this address" : i.status.toLowerCase()}</Pill>
                {i.list ? <span className="text-muted">{i.list.name}</span> : null}
                <span className="text-muted">last mail {ago(i.lastMessageAt)}</span>
                {i.lastSyncError ? <span className="text-[#912018]">{i.lastSyncError}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-muted">All inboxes are receiving mail.</p>
        )}
      </section>
    </div>
  );
}
