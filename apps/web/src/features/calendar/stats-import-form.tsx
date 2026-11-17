"use client";

import { Button } from "@pubcommand/ui";
import { useState } from "react";
import { guessMapping, missingRequired, parseCsv, STAT_FIELDS, type ColumnMapping } from "../../../../../modules/editorial/stats";

/** Reads the CSV in the browser to offer a column mapping, then uploads file + mapping together. */
export function StatsImportForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [header, setHeader] = useState<string[] | null>(null);
  const [sample, setSample] = useState<string[] | null>(null);
  const [rows, setRows] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [problem, setProblem] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setProblem(null);
    setHeader(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setProblem("That file is over 20 MB. Export a shorter date range.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setProblem("That file has no data rows. Export it as CSV with a header row.");
      return;
    }
    setHeader(parsed[0]!);
    setSample(parsed[1]!);
    setRows(parsed.length - 1);
    setMapping(guessMapping(parsed[0]!));
  }

  const missing = header ? missingRequired(mapping) : [];
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="stats-file" className="text-sm font-medium">
          ESP export (.csv)
        </label>
        <input
          id="stats-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => onFile(event.target.files?.[0])}
          className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        <p className="mt-1 text-xs text-muted">One row per send. Any ESP works: match its columns below.</p>
      </div>
      {problem ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{problem}</p> : null}
      {header ? (
        <>
          <p className="text-sm text-muted">{rows} rows found. Check which column holds each value; we guessed from the headers.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {STAT_FIELDS.map((f) => (
              <label key={f.key} className="block min-w-0 text-sm">
                <span className="font-medium">
                  {f.label}
                  {f.required ? <span className="text-[#b42318]"> *</span> : null}
                </span>
                <select
                  name={`map_${f.key}`}
                  className="pc-control mt-1 w-full"
                  value={mapping[f.key] ?? ""}
                  onChange={(event) => setMapping((m) => ({ ...m, [f.key]: event.target.value === "" ? undefined : Number(event.target.value) }))}
                >
                  <option value="">Not in this file</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                      {sample?.[i] ? ` (e.g. ${sample[i]!.slice(0, 30)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <fieldset className="text-sm">
            <legend className="font-medium">Rates without a % sign are written as</legend>
            <label className="mr-4 inline-flex min-h-11 items-center gap-2">
              <input type="radio" name="rateFormat" value="percent" defaultChecked /> Percent (4.23 means 4.23%)
            </label>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input type="radio" name="rateFormat" value="ratio" /> Fraction (0.0423 means 4.23%)
            </label>
          </fieldset>
          {missing.length ? <p className="text-sm text-[#b42318]">Choose a column for: {missing.join(", ")}.</p> : null}
          <Button type="submit" disabled={missing.length > 0} className="w-full sm:w-auto">
            Import and match
          </Button>
        </>
      ) : null}
    </form>
  );
}
