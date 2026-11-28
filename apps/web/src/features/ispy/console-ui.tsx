import Link from "next/link";
import type { ReactNode } from "react";
import { CONDITION_FIELD_LABELS, CONDITION_FIELDS, CONDITION_OP_LABELS, CONDITION_OPS, type RuleCondition } from "../../../../../modules/ispy/index";

/** Shared bits for the ISpy console pages (server components only). */

export const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas";
export const btnSm = "inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas";
export const btnPrimary = "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white hover:opacity-90";
export const btnDanger = "inline-flex min-h-9 items-center justify-center rounded-md border border-[#fecdca] bg-white px-3 text-sm font-semibold text-[#912018] hover:bg-[#fef3f2]";
export const input = "pc-control w-full";
export const label = "flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted";
export const card = "rounded-lg border border-line bg-white";
export const th = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted";
export const td = "px-3 py-2 align-top text-sm";

const NAV: { href: string; label: string }[] = [
  { href: "/ispy", label: "Overview" },
  { href: "/ispy/publications", label: "Publications" },
  { href: "/ispy/affiliates", label: "Affiliate Lists" },
  { href: "/ispy/gurus", label: "Gurus" },
  { href: "/ispy/inboxes", label: "Inboxes & routing" },
  { href: "/ispy/approvals", label: "New lists" },
  { href: "/ispy/reports", label: "Reports" },
  { href: "/ispy/promos", label: "Promos" },
  { href: "/ispy/copies", label: "Copies" },
  { href: "/ispy/access", label: "Access" },
  { href: "/ispy/import", label: "Import" },
  { href: "/ispy/settings", label: "Settings" },
];

export function IspyNav({ pathname, counts }: { pathname: string; counts: { candidates: number; reports: number } }) {
  return (
    <nav aria-label="ISpy" className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white p-1">
      {NAV.map((item) => {
        const active = item.href === "/ispy" ? pathname === "/ispy" : pathname.startsWith(item.href);
        const count = item.href === "/ispy/approvals" ? counts.candidates : item.href === "/ispy/reports" ? counts.reports : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${active ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}
          >
            {item.label}
            {count ? <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20" : "bg-[#fff1c2] text-[#6b4700]"}`}>{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

const PILL: Record<string, string> = {
  ok: "bg-[#d6f5df] text-[#14532d]",
  warn: "bg-[#fff1c2] text-[#6b4700]",
  muted: "bg-[#eef0f3] text-[#3e4a5c]",
  blue: "bg-[#dbe6ff] text-[#1e3a8a]",
  purple: "bg-[#ebe3ff] text-[#44238f]",
  teal: "bg-[#d3f0eb] text-[#0b5248]",
  orange: "bg-[#ffe6cf] text-[#7a3300]",
  red: "bg-[#fef3f2] text-[#912018]",
};

export function Pill({ tone = "muted", children }: { tone?: keyof typeof PILL | string; children: ReactNode }) {
  return <span className={`inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2 text-xs font-bold ${PILL[tone] ?? PILL.muted}`}>{children}</span>;
}

export function statusTone(status: string): string {
  if (status === "ACTIVE" || status === "APPLIED" || status === "APPROVED") return "ok";
  if (status === "PENDING_SIGNUP" || status === "SILENT" || status === "PENDING" || status === "OPEN") return "warn";
  if (status === "ERROR" || status === "REJECTED") return "red";
  return "muted";
}

export function typeTone(type: string): string {
  switch (type) {
    case "PROMO":
      return "blue";
    case "INTERNAL_LIFT":
    case "INTERNAL":
      return "teal";
    case "EXTERNAL_LIFT":
      return "orange";
    case "AFFILIATE":
      return "purple";
    default:
      return "muted";
  }
}

/** A sortable column header: a link that flips direction when already sorted by it. */
export function SortTh({ base, params, sortKey, children, align }: { base: string; params: Record<string, string | undefined>; sortKey: string; children: ReactNode; align?: "right" }) {
  const current = params.sort ?? "";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const next = current === sortKey && dir === "desc" ? "asc" : "desc";
  const search = new URLSearchParams(Object.entries({ ...params, sort: sortKey, dir: next }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "" && entry[0] !== "error" && entry[0] !== "notice"));
  const arrow = current === sortKey ? (dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th scope="col" className={`${th} ${align === "right" ? "text-right" : ""}`} aria-sort={current === sortKey ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`${base}?${search.toString()}`} className="inline-flex min-h-8 items-center gap-1 hover:text-ink">
        {children} <span aria-hidden="true">{arrow}</span>
      </Link>
    </th>
  );
}

/** Sort rows in memory by a key → value map. */
export function sortRows<T>(rows: T[], params: { sort?: string; dir?: string }, values: Record<string, (row: T) => string | number | Date | null | undefined>, fallback: string): T[] {
  const key = params.sort && values[params.sort] ? params.sort : fallback;
  const dir = params.sort ? (params.dir === "asc" ? 1 : -1) : -1;
  const get = values[key]!;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const xv = x instanceof Date ? x.getTime() : typeof x === "string" ? x.toLowerCase() : x ?? -Infinity;
    const yv = y instanceof Date ? y.getTime() : typeof y === "string" ? y.toLowerCase() : y ?? -Infinity;
    return xv < yv ? -dir : xv > yv ? dir : 0;
  });
}

export function day(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export function ago(d: Date | null | undefined): string {
  if (!d) return "—";
  const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Hidden "back" field: actions redirect here with ?notice= / ?error=. */
export function Back({ to }: { to: string }) {
  return <input type="hidden" name="back" value={to} />;
}

/** Four condition rows (AND-ed). Empty rows are ignored on save. */
export function ConditionRows({ conditions, prefix = "cond" }: { conditions?: RuleCondition[]; prefix?: string }) {
  const rows = [...(conditions ?? [])];
  while (rows.length < 4) rows.push({ field: "fromAddress", op: "equals", value: "" });
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold text-muted">Conditions (all must match)</legend>
      {rows.slice(0, 6).map((c, i) => (
        <div key={i} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
          <select name={`${prefix}_field_${i}`} defaultValue={c.field} aria-label={`Condition ${i + 1} field`} className={input}>
            {CONDITION_FIELDS.map((f) => (
              <option key={f} value={f}>
                {CONDITION_FIELD_LABELS[f]}
              </option>
            ))}
          </select>
          <select name={`${prefix}_op_${i}`} defaultValue={c.op} aria-label={`Condition ${i + 1} test`} className={input}>
            {CONDITION_OPS.map((o) => (
              <option key={o} value={o}>
                {CONDITION_OP_LABELS[o]}
              </option>
            ))}
          </select>
          <input name={`${prefix}_value_${i}`} defaultValue={c.value} aria-label={`Condition ${i + 1} value`} placeholder={i === 0 ? "e.g. alerts@tradeoftheday.com" : "(optional)"} className={input} />
        </div>
      ))}
      <p className="text-xs text-muted">For “Any header”, write the value as <code>header-name: value</code>. Regex patterns are case-insensitive.</p>
    </fieldset>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-6 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}

export function Pager({ total, page, params, base, noun = "item(s)", size = 50 }: { total: number; page: number; params: Record<string, string | undefined>; base: string; noun?: string; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (n: number) => `${base}?${queryString({ ...params, page: String(n) })}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        {total} {noun} · page {page} of {pages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? <a className={btnSm} href={href(page - 1)}>← Previous</a> : null}
        {page < pages ? <a className={btnSm} href={href(page + 1)}>Next →</a> : null}
      </span>
    </div>
  );
}

/** A query string from page params, without the flash messages. */
export function queryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && e[0] !== "error" && e[0] !== "notice");
  return new URLSearchParams(entries).toString();
}
