"use client";

import { Button } from "@pubcommand/ui";
import { useActionState } from "react";
import { commitImport, previewImport, type ImportPreview } from "./import-actions";

const ACTION_LABEL = { create: "Add", fill: "Fill in", same: "No change" } as const;
const ACTION_STYLE = { create: "bg-[#ecfdf3] text-[#067647]", fill: "bg-[#eff8ff] text-[#175cd3]", same: "bg-canvas text-muted" } as const;

export function ImportForm() {
  const [preview, run, pending] = useActionState<ImportPreview, FormData>(previewImport, null);
  const ok = preview?.ok ? preview : null;
  const changes = ok ? ok.counts.create + ok.counts.fill + ok.counts.links + (ok.brandLogo ? 1 : 0) : 0;

  return (
    <div className="space-y-4">
      <form action={run} className="space-y-3 rounded-xl border border-line bg-white p-4">
        <label htmlFor="import-file" className="block text-sm font-semibold">
          Import file (.json)
        </label>
        <input id="import-file" name="file" type="file" accept=".json,application/json" className="block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-4 text-sm" />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Dry run"}
        </Button>
        <p className="text-xs text-muted">
          The dry run changes nothing. Importing adds new publications and editors, and only fills in fields that are blank here. Anything already typed in Publication Setup is kept.
        </p>
      </form>

      {preview && !preview.ok ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{preview.error}</p> : null}

      {ok ? (
        <section className="space-y-4 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Dry run</h2>
          <p className="text-sm">
            {ok.counts.create} to add · {ok.counts.fill} to fill in · {ok.counts.same} unchanged · {ok.counts.links} editor link{ok.counts.links === 1 ? "" : "s"} to add
            {ok.brandLogo ? " · brand logo" : ""}
          </p>
          {ok.warnings.length ? (
            <ul className="list-disc space-y-1 rounded-md border border-[#fedf89] bg-[#fffaeb] py-2 pl-8 pr-3 text-sm text-[#93370d]">
              {ok.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <ul className="divide-y divide-line rounded-md border border-line">
            {ok.rows.map((row) => (
              <li key={`${row.kind}-${row.code ?? row.name}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ACTION_STYLE[row.action]}`}>{ACTION_LABEL[row.action]}</span>
                <span className="text-xs uppercase tracking-wider text-muted">{row.kind === "publication" ? "Publication" : "Editor"}</span>
                <span className="font-medium [overflow-wrap:anywhere]">
                  {row.name}
                  {row.code ? ` (${row.code})` : ""}
                </span>
                {row.action === "fill" ? <span className="text-xs text-muted [overflow-wrap:anywhere]">{row.detail}</span> : null}
              </li>
            ))}
          </ul>
          {ok.links.some((l) => l.action === "create") ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-accent">Editor links to add</summary>
              <ul className="mt-2 space-y-1 text-sm">
                {ok.links
                  .filter((l) => l.action === "create")
                  .map((l) => (
                    <li key={`${l.code}-${l.editor}`}>
                      {l.code} · {l.editor} ({l.role})
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          {changes > 0 ? (
            <form action={commitImport}>
              <input type="hidden" name="text" value={ok.text} />
              <Button type="submit">Import</Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Everything in this file is already here. Nothing to import.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
