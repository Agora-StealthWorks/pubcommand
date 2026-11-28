import { Flash } from "@/components/ui";
import { applyReportAction, dismissReport } from "@/features/ispy/console-actions";
import { Back, btnDanger, btnPrimary, card, day, Pill, SortTh, sortRows, statusTone, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Reports" };

/** "Not a promo" and "duplicate" feedback from org admins and staff. Applying makes it stick. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const showAll = query.show === "all";
  const data = await ispyDb(async (tx) => {
    const reports = await tx.ispyReport.findMany({ where: showAll ? {} : { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 200 });
    const ids = (type: string) => reports.filter((r) => r.targetType === type).map((r) => r.targetId);
    const dupIds = reports.map((r) => r.duplicateOfId).filter((x): x is string => !!x);
    const [emails, copies, promos, dupPromos, dupCopies, orgs, users] = await Promise.all([
      tx.ispyEmail.findMany({ where: { id: { in: ids("EMAIL") } }, select: { id: true, subject: true, promoId: true } }),
      tx.ispyCopy.findMany({ where: { id: { in: ids("COPY") } }, select: { id: true, title: true, sendCount: true } }),
      tx.ispyPromo.findMany({ where: { id: { in: ids("PROMO") } }, select: { id: true, headline: true, landingUrl: true } }),
      tx.ispyPromo.findMany({ where: { id: { in: dupIds } }, select: { id: true, headline: true, landingUrl: true } }),
      tx.ispyCopy.findMany({ where: { id: { in: dupIds } }, select: { id: true, title: true } }),
      tx.organization.findMany({ where: { id: { in: reports.map((r) => r.reporterOrgId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      tx.user.findMany({ where: { id: { in: reports.map((r) => r.reporterId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const title = new Map<string, string>([
      ...emails.map((e) => [e.id, `Email “${e.subject}”`] as const),
      ...copies.map((c) => [c.id, `Copy “${c.title}” (${c.sendCount} sends)`] as const),
      ...promos.map((p) => [p.id, `Promo “${p.headline ?? p.landingUrl}”`] as const),
    ]);
    const dupTitle = new Map<string, string>([...dupPromos.map((p) => [p.id, p.headline ?? p.landingUrl] as const), ...dupCopies.map((c) => [c.id, c.title] as const)]);
    return { reports, title, dupTitle, orgName: new Map(orgs.map((o) => [o.id, o.name])), userName: new Map(users.map((u) => [u.id, u.name ?? "someone"])) };
  });
  const back = `/ispy/reports${showAll ? "?show=all" : ""}`;
  const rows = sortRows(data.reports, query, { date: (r) => r.createdAt, kind: (r) => r.kind, status: (r) => r.status, org: (r) => (r.reporterOrgId ? data.orgName.get(r.reporterOrgId) ?? "" : "staff") }, "date");
  const params = { ...query };
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reports</h2>
          <p className="max-w-3xl text-sm text-muted">Feedback from org admins and staff. Apply a “not a promo” to block that page for good; apply a “duplicate” to merge it into the one it duplicates.</p>
        </div>
        <a className="text-sm underline" href={showAll ? "/ispy/reports" : "/ispy/reports?show=all"}>{showAll ? "Open only" : "Show all"}</a>
      </div>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/reports" params={params} sortKey="date">Date</SortTh>
                <SortTh base="/ispy/reports" params={params} sortKey="kind">Report</SortTh>
                <th scope="col" className={th}>About</th>
                <SortTh base="/ispy/reports" params={params} sortKey="org">From</SortTh>
                <SortTh base="/ispy/reports" params={params} sortKey="status">Status</SortTh>
                <th scope="col" className={th}>Decide</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No {showAll ? "" : "open "}reports.</td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className={`${td} whitespace-nowrap`}>{day(r.createdAt)}</td>
                  <td className={td}>
                    <Pill tone={r.kind === "NOT_A_PROMO" ? "red" : "blue"}>{r.kind === "NOT_A_PROMO" ? "Not a promo" : "Duplicate"}</Pill>
                  </td>
                  <td className={td}>
                    {data.title.get(r.targetId) ?? `${r.targetType.toLowerCase()} ${r.targetId.slice(0, 8)} (gone)`}
                    {r.duplicateOfId ? <div className="text-xs text-muted">duplicate of: {data.dupTitle.get(r.duplicateOfId) ?? r.duplicateOfId}</div> : null}
                    {r.note ? <div className="text-xs text-muted">“{r.note}”</div> : null}
                  </td>
                  <td className={td}>
                    {r.reporterOrgId ? data.orgName.get(r.reporterOrgId) ?? "an org" : "staff"}
                    {r.reporterId ? <div className="text-xs text-muted">{data.userName.get(r.reporterId) ?? ""}</div> : null}
                  </td>
                  <td className={td}><Pill tone={statusTone(r.status)}>{r.status.toLowerCase()}</Pill></td>
                  <td className={td}>
                    {r.status === "OPEN" ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={applyReportAction}>
                          <Back to={back} />
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className={btnPrimary}>Apply</button>
                        </form>
                        <form action={dismissReport}>
                          <Back to={back} />
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className={btnDanger}>Dismiss</button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-sm text-muted">{day(r.decidedAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
