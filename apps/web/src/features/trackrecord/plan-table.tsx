import type { ImportPlan } from "../../../../../modules/performance/positions";

const ACTION_STYLE: Record<string, string> = {
  create: "bg-[#dcfae6] text-[#067647]",
  close: "bg-[#dbe7ff] text-[#1e3a8a]",
  skip: "bg-canvas text-muted",
  error: "bg-[#fee4e2] text-[#b42318]",
};

/** The dry-run table: what each row of a file, sheet or Airtable table would do. */
export function PlanTable({ plan }: { plan: ImportPlan }) {
  return (
    <>
      <p className="text-sm">
        {plan.counts.create} new · {plan.counts.close} to close · {plan.counts.skip} already recorded · {plan.counts.error} with errors
      </p>
      {plan.newPortfolios.length ? <p className="text-sm text-muted">New portfolios will be created: {plan.newPortfolios.join(", ")}.</p> : null}
      {plan.unknownColumns.length ? <p className="text-sm text-muted">Ignored columns: {plan.unknownColumns.join(", ")}.</p> : null}
      <div className="pc-scroll max-h-[50vh] overflow-y-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Line</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Portfolio</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">What happens</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr key={row.line} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums">{row.line}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_STYLE[row.action]}`}>{row.action}</span>
                </td>
                <td className="px-3 py-2">{row.portfolio || "—"}</td>
                <td className="px-3 py-2 font-semibold">{row.draft?.symbol ?? "—"}</td>
                <td className="px-3 py-2">{row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
