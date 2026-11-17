import Link from "next/link";
import { contrastInk, STAGE_COLORS, STAGE_LABELS, type StageKey } from "../../../../../modules/editorial/stages";

export function PubChip({ code, color }: { code: string; color?: string | null }) {
  const bg = color || STAGE_COLORS.issue;
  return (
    <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide" style={{ background: bg, color: contrastInk(bg) }}>
      {code}
    </span>
  );
}

export function StageDot({ stage }: { stage: StageKey | "issue" }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STAGE_COLORS[stage] }} aria-hidden />;
}

export function StageNow({ stage }: { stage: StageKey | null }) {
  if (!stage) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${STAGE_COLORS[stage]}1a`, color: STAGE_COLORS[stage] }}>
      <StageDot stage={stage} />
      {STAGE_LABELS[stage]} now
    </span>
  );
}

export function StageLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {(["pre", "event", "post", "issue"] as const).map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <StageDot stage={key} />
          {key === "issue" ? "Editorial issue" : STAGE_LABELS[key]}
        </span>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-white px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function LinkButton({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white"
          : "inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas"
      }
    >
      {children}
    </Link>
  );
}

export function ExternalLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="break-words [overflow-wrap:anywhere] font-medium text-accent hover:underline">
      {children}
    </a>
  );
}

export function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
}

export function count(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

export function pct(ratio: number | null | undefined): string {
  return ratio == null ? "—" : `${(ratio * 100).toFixed(2)}%`;
}

export function PromoSelect({ promos, value, name = "promoId", label = "Promo (Promo Analyzer)", hint }: { promos: { id: string; title: string; promoStatus: string | null; stage: string | null }[]; value?: string | null; name?: string; label?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? (promos.length ? undefined : "No promos yet. Add them in Promo Analyzer.")}>
      <select name={name} className="pc-control w-full" defaultValue={value ?? ""}>
        <option value="">No promo</option>
        {promos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
            {p.stage ? ` · ${p.stage}` : ""}
            {p.promoStatus ? ` (${p.promoStatus})` : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function OptionSelect({ name, options, value, label }: { name: string; options: string[]; value?: string | null; label: string }) {
  const list = value && !options.includes(value) ? [...options, value] : options;
  return (
    <Field label={label}>
      <select name={name} className="pc-control w-full" defaultValue={value ?? list[0] ?? ""}>
        {list.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </Field>
  );
}

/** A linked Promo Analyzer promo with its pipeline stage and Promo Analyzer status. */
export function PromoLine({ promo }: { promo: { id: string; title: string; promoStatus: string | null; stage: string | null } | null }) {
  if (!promo) return <span>—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Link href={`/promo-studio/${promo.id}`} className="break-words [overflow-wrap:anywhere] font-medium text-accent hover:underline">
        {promo.title}
      </Link>
      {promo.stage ? <span className="rounded-full bg-[#fde8f2] px-2 py-0.5 text-xs font-semibold text-[#8a1155]">{promo.stage}</span> : null}
      {promo.promoStatus ? <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">{promo.promoStatus}</span> : null}
    </span>
  );
}
