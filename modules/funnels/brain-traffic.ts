/**
 * Funnel traffic for the Operations Brain. PURE. Takes counts that were already
 * aggregated in the database (no visitor ids, emails, IPs or raw rows) and turns
 * them into a short text the nightly read can learn from: which funnels drew
 * people, how many opted in or clicked the offer, how far viewers got through
 * the episodes, and which tracked sources and campaigns brought them.
 */

export type FunnelTrafficRow = {
  organization: string;
  funnel: string;
  /** launch | microsite */
  siteType: string;
  visitors: number;
  views: number;
  optins: number;
  /** Visitors with at least one offer / CTA click. */
  offerClickers: number;
  /** Visitors per device (mobile | tablet | desktop). */
  devices: Record<string, number>;
  /** Distinct visitors per module / episode position, in order. */
  reach: { position: number; visitors: number }[];
  /** Visitors and opt-ins per tracked parameter value. */
  params: { key: string; value: string; visitors: number; optins: number }[];
};

export const BRAIN_MAX_FUNNELS = 15;
export const BRAIN_MAX_PARAM_VALUES = 5;

/**
 * A tracked parameter value safe to show the Brain: trimmed, short, and never
 * something that looks like a person (an email address or a phone / account number).
 */
export function safeParamValue(value: string): string | null {
  const v = value.trim().slice(0, 60);
  if (!v) return null;
  if (v.includes("@")) return null;
  if (/\d[\d\s().-]{6,}\d/.test(v)) return null;
  return v;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const p = (part / whole) * 100;
  return `${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
}

function devicesText(devices: Record<string, number>): string {
  const total = Object.values(devices).reduce((s, n) => s + n, 0);
  if (!total) return "";
  return Object.entries(devices)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([device, n]) => `${device} ${pct(n, total)}`)
    .join(", ");
}

/** One funnel as a few lines of text. */
export function funnelTrafficLines(row: FunnelTrafficRow): string[] {
  const lines = [
    `- **${row.organization} · ${row.funnel}** (${row.siteType === "microsite" ? "microsite" : "launch funnel"}): ${row.visitors} visitors, ${row.views} page views, ${row.optins} opt-ins (${pct(row.optins, row.visitors)} of visitors), ${row.offerClickers} offer clickers (${pct(row.offerClickers, row.visitors)})`,
  ];
  const devices = devicesText(row.devices);
  if (devices) lines.push(`  - Devices: ${devices}`);
  const reach = [...row.reach].sort((a, b) => a.position - b.position).filter((r) => r.visitors > 0);
  if (reach.length > 1) {
    const first = reach[0]!.visitors;
    lines.push(`  - Reach by module: ${reach.map((r) => `#${r.position} ${r.visitors}${first ? ` (${pct(r.visitors, first)})` : ""}`).join(" → ")}`);
  }
  const byKey = new Map<string, { value: string; visitors: number; optins: number }[]>();
  for (const p of row.params) {
    const value = safeParamValue(p.value);
    if (!value || (p.visitors <= 0 && p.optins <= 0)) continue;
    const list = byKey.get(p.key) ?? [];
    const same = list.find((item) => item.value === value);
    if (same) {
      same.visitors += p.visitors;
      same.optins += p.optins;
    } else list.push({ value, visitors: p.visitors, optins: p.optins });
    byKey.set(p.key, list);
  }
  for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const top = list.sort((a, b) => b.visitors - a.visitors || b.optins - a.optins).slice(0, BRAIN_MAX_PARAM_VALUES);
    lines.push(`  - By ${key}: ${top.map((item) => `${item.value} ${item.visitors} visitors / ${item.optins} opt-ins${item.visitors ? ` (${pct(item.optins, item.visitors)})` : ""}`).join("; ")}`);
  }
  return lines;
}

/** The "Funnel traffic" text: busiest funnels first, people only (bots left out upstream). */
export function funnelTrafficText(rows: readonly FunnelTrafficRow[]): string {
  const active = rows.filter((row) => row.visitors > 0 || row.optins > 0).sort((a, b) => b.visitors - a.visitors || b.optins - a.optins);
  if (!active.length) return "";
  const totals = active.reduce((t, row) => ({ visitors: t.visitors + row.visitors, optins: t.optins + row.optins, clickers: t.clickers + row.offerClickers }), { visitors: 0, optins: 0, clickers: 0 });
  const head = `- All funnels: ${totals.visitors} visitors, ${totals.optins} opt-ins (${pct(totals.optins, totals.visitors)}), ${totals.clickers} offer clickers (${pct(totals.clickers, totals.visitors)}) across ${active.length} funnel${active.length === 1 ? "" : "s"}`;
  const shown = active.slice(0, BRAIN_MAX_FUNNELS).flatMap(funnelTrafficLines);
  const more = active.length > BRAIN_MAX_FUNNELS ? [`- …and ${active.length - BRAIN_MAX_FUNNELS} more funnels with lighter traffic`] : [];
  return [head, ...shown, ...more].join("\n");
}
