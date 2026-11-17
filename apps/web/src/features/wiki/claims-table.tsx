"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TableScroll } from "@/components/table-scroll";
import type { ClaimCategory, ClaimFile, ClaimRow } from "@/features/trackrecord/editor-profile";
import { GainText, PriceNote } from "@/features/trackrecord/ui";
import { formatPrice } from "../../../../../modules/performance/gain";

const BASIS_LABEL: Record<string, string> = { TODAY: "To today", PEAK: "To peak", EXIT: "To exit", NONE: "No gain" };
const iso = (date: Date | null) => (date ? new Date(date).toISOString().slice(0, 10) : "—");
const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp)$/.test(mime);

function fileHref(callId: string, file: ClaimFile, download = false) {
  return `/performance/archive/${callId}/files/${file.id}${download ? "?download=1" : ""}`;
}

function Backup({ claim }: { claim: ClaimRow }) {
  if (!claim.files.length) return <span className="text-muted">No files</span>;
  const thumb = claim.files.find((f) => isImage(f.mimeType));
  return (
    <div className="flex min-w-0 items-start gap-2">
      {thumb ? (
        <a href={fileHref(claim.id, thumb)} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`View ${thumb.filename}`}>
          <img src={fileHref(claim.id, thumb)} alt="" loading="lazy" className="h-10 w-10 rounded border border-line object-cover" />
        </a>
      ) : null}
      <details className="min-w-0">
        <summary className="cursor-pointer whitespace-nowrap text-accent">
          {claim.files.length} file{claim.files.length === 1 ? "" : "s"}
        </summary>
        <ul className="mt-1 space-y-1">
          {claim.files.map((f) => (
            <li key={f.id} className="min-w-0 text-xs">
              <span className="block truncate [overflow-wrap:anywhere]" title={f.filename}>
                {f.filename}
              </span>
              <a href={fileHref(claim.id, f)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                View
              </a>
              {" · "}
              <a href={fileHref(claim.id, f, true)} className="text-accent hover:underline">
                Download
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Categories({ ids, byId }: { ids: string[]; byId: Map<string, ClaimCategory> }) {
  const list = ids.map((id) => byId.get(id)).filter((c): c is ClaimCategory => !!c);
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-canvas px-2 py-0.5 text-xs">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} aria-hidden />
          {c.name}
        </span>
      ))}
    </div>
  );
}

function Gain({ claim }: { claim: ClaimRow }) {
  return (
    <>
      <GainText pct={claim.gain.pct} />
      <span className="block text-xs text-muted">{BASIS_LABEL[claim.gainBasis] ?? claim.gainBasis}</span>
      <PriceNote gain={claim.gain} />
    </>
  );
}

function Entry({ claim }: { claim: ClaimRow }) {
  return (
    <span className="tabular-nums">
      {formatPrice(claim.entryPrice)}
      {claim.priceCheck.includes("entryPrice") ? (
        <span className="block text-xs font-semibold text-[#b54708]" title="Read from the document by AI and not checked yet">
          Check
        </span>
      ) : null}
    </span>
  );
}

/** The editor's calls: newest first by default, filterable by category. A table from md up, stacked rows below. */
export function ClaimsTable({ claims, categories }: { claims: ClaimRow[]; categories: ClaimCategory[] }) {
  const [category, setCategory] = useState("");
  const [order, setOrder] = useState<"new" | "old">("new");
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const used = useMemo(() => categories.filter((c) => claims.some((claim) => claim.categoryIds.includes(c.id))), [categories, claims]);
  const rows = useMemo(() => {
    const list = category ? claims.filter((c) => c.categoryIds.includes(category)) : [...claims];
    const time = (c: ClaimRow) => (c.callDate ? new Date(c.callDate).getTime() : 0);
    return list.sort((a, b) => (order === "new" ? time(b) - time(a) : time(a) - time(b)));
  }, [claims, category, order]);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {used.length ? (
          <label className="min-w-0 text-xs font-semibold text-muted">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="pc-control mt-1 block w-full min-w-[10rem]">
              <option value="">All categories</option>
              {used.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="min-w-0 text-xs font-semibold text-muted">
          Sort
          <select value={order} onChange={(e) => setOrder(e.target.value === "old" ? "old" : "new")} className="pc-control mt-1 block w-full min-w-[9rem]">
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
          </select>
        </label>
        {category ? <p className="pb-2 text-xs text-muted">{rows.length} shown</p> : null}
      </div>

      {rows.length === 0 ? <p className="text-sm text-muted">No calls in this category.</p> : null}

      {/* Phones: one card per call. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((c) => (
          <li key={c.id} className="min-w-0 rounded-lg border border-line p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted tabular-nums">
                  {iso(c.callDate)} · {c.ticker ?? "No ticker"} · {c.callType} · {c.direction === "SHORT" ? "Short" : "Long"}
                </p>
                <Link href={`/performance/archive/${c.id}`} className="font-semibold text-accent [overflow-wrap:anywhere]">
                  {c.title}
                </Link>
              </div>
              <div className="max-w-[45%] shrink-0 text-right">
                <Gain claim={c} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2 text-xs">
              <span>
                <span className="text-muted">Entry </span>
                <Entry claim={c} />
              </span>
              <Categories ids={c.categoryIds} byId={byId} />
            </div>
            <div className="mt-2 text-xs">
              <Backup claim={c} />
            </div>
          </li>
        ))}
      </ul>

      {/* Tablets and up: the table, scrolling inside its own box if it ever needs to. */}
      {rows.length ? (
        <div className="hidden md:block">
          <TableScroll>
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="whitespace-nowrap bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Claim</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Entry</th>
                  <th className="px-3 py-2 text-right">Gain</th>
                  <th className="px-3 py-2">Categories</th>
                  <th className="px-3 py-2">Backup</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{iso(c.callDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">{c.ticker ?? "—"}</td>
                    <td className="min-w-[14rem] px-3 py-2">
                      <Link href={`/performance/archive/${c.id}`} className="font-semibold text-accent hover:underline [overflow-wrap:anywhere]">
                        {c.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {c.callType}
                      <span className="block text-xs text-muted">{c.direction === "SHORT" ? "Short" : "Long"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Entry claim={c} />
                    </td>
                    <td className="min-w-[8rem] px-3 py-2 text-right">
                      <Gain claim={c} />
                    </td>
                    <td className="px-3 py-2">
                      <Categories ids={c.categoryIds} byId={byId} />
                    </td>
                    <td className="min-w-[9rem] max-w-[16rem] px-3 py-2">
                      <Backup claim={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      ) : null}
    </div>
  );
}
