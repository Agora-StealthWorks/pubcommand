"use client";

import { Button, Label, Textarea } from "@pubcommand/ui";
import { useActionState } from "react";
import { commitImport, previewImport, type ImportPreview } from "./actions";

const ACTION_STYLE: Record<string, string> = {
  create: "bg-[#dcfae6] text-[#067647]",
  close: "bg-[#dbe7ff] text-[#1e3a8a]",
  skip: "bg-canvas text-muted",
  error: "bg-[#fee4e2] text-[#b42318]",
};

export function ImportForm({ portfolios }: { portfolios: string[] }) {
  const [preview, run, pending] = useActionState<ImportPreview, FormData>(previewImport, null);
  const plan = preview?.ok ? preview.plan : null;
  const importable = plan ? plan.counts.create + plan.counts.close : 0;

  return (
    <div className="space-y-4">
      <form action={run} className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div>
          <Label htmlFor="import-portfolio">Portfolio for rows without one</Label>
          <select id="import-portfolio" name="defaultPortfolio" className="pc-control w-full sm:w-80" defaultValue={preview?.ok ? preview.defaultPortfolio : (portfolios[0] ?? "")}>
            <option value="">Use the file&apos;s portfolio column</option>
            {portfolios.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="import-file">CSV file</Label>
          <input id="import-file" name="file" type="file" accept=".csv,.tsv,.txt,text/csv" className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-4 text-sm" />
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-accent">…or paste rows from a spreadsheet</summary>
          <Textarea name="csv" rows={8} className="mt-2 font-mono text-xs" defaultValue={preview?.ok ? preview.csv : ""} placeholder="symbol,direction,entry date,entry price,exit date,exit price" />
        </details>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Dry run"}
        </Button>
        <p className="text-xs text-muted">The dry run changes nothing. It shows what each row would do so you can fix the file first.</p>
      </form>

      {preview && !preview.ok ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{preview.error}</p> : null}

      {plan ? (
        <section className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Dry run</h2>
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
          {importable > 0 && preview?.ok ? (
            <form action={commitImport}>
              <input type="hidden" name="csv" value={preview.csv} />
              <input type="hidden" name="defaultPortfolio" value={preview.defaultPortfolio} />
              <Button type="submit">
                Import {importable} row{importable === 1 ? "" : "s"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Nothing to import yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
