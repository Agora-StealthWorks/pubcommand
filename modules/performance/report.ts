/**
 * The Friday weekly performance report email. Pure: positions with computed gains in, subject/HTML/text out.
 *
 * Content rules:
 *   - Per portfolio: this week's opens and closes (closes listed in date order, never sorted by gain), the
 *     week's win rate and average, and since-inception figures. All numbers come from computeGain() results.
 *   - No people: no recipient names or addresses, no authors, no notes fields. Only the brand, portfolio and
 *     publication names a team chose, and symbols.
 *   - No loser count, no worst trade and no losers list (the standing rule for every Track Record output).
 */
import { formatPct, formatPrice } from "./gain";
import { computeStats, isoWeek, weekBounds, type StatPosition } from "./stats";

export type ReportPortfolio = { name: string; publication: string; positions: readonly StatPosition[] };

export type WeeklyReport = { week: string; subject: string; text: string; html: string; closedThisWeek: number; openedThisWeek: number };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const rate = (value: number | null) => (value == null ? "n/a" : `${Math.round(value * 100)}%`);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

type Section = {
  label: string;
  opened: StatPosition[];
  closed: StatPosition[];
  week: ReturnType<typeof computeStats>;
  all: ReturnType<typeof computeStats>;
};

function sections(portfolios: readonly ReportPortfolio[], start: Date, end: Date): Section[] {
  const endMs = end.getTime() + 86_399_999;
  const inWeek = (date: Date | null) => !!date && date.getTime() >= start.getTime() && date.getTime() <= endMs;
  return portfolios.map((p) => {
    const closed = p.positions
      .filter((x) => x.status === "CLOSED" && inWeek(x.exitDate) && x.gainPct != null)
      .sort((a, b) => (a.exitDate as Date).getTime() - (b.exitDate as Date).getTime() || a.symbol.localeCompare(b.symbol));
    const opened = p.positions.filter((x) => inWeek(x.entryDate)).sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime() || a.symbol.localeCompare(b.symbol));
    return { label: p.publication ? `${p.name} (${p.publication})` : p.name, opened, closed, week: computeStats(closed), all: computeStats(p.positions) };
  });
}

/** `appUrl` (optional) links back to Track Record in the app. */
export function weeklyReport(input: { brandName: string; portfolios: readonly ReportPortfolio[]; today: Date; appUrl?: string | null }): WeeklyReport {
  const week = isoWeek(input.today);
  const { start, end } = weekBounds(input.today);
  const friday = new Date(start.getTime() + 4 * 86_400_000);
  const list = sections(input.portfolios, start, end);
  const closedThisWeek = list.reduce((n, s) => n + s.closed.length, 0);
  const openedThisWeek = list.reduce((n, s) => n + s.opened.length, 0);
  const subject = `${input.brandName} – Weekly Performance Report, week ending ${iso(friday)}`;
  const side = (p: StatPosition) => (p.direction === "SHORT" ? "Short" : "Long");

  const text = [
    subject,
    "",
    `${closedThisWeek} recommendation(s) closed and ${openedThisWeek} opened this week (${iso(start)} to ${iso(end)}).`,
    "",
    ...list.flatMap((s) => [
      `== ${s.label} ==`,
      `This week: ${s.opened.length} opened, ${s.closed.length} closed${s.closed.length ? `, win rate ${rate(s.week.winRate)}, average ${formatPct(s.week.avgGain)}` : ""}.`,
      ...s.closed.map((p) => `  ${p.exitDate ? iso(p.exitDate) : ""}  ${p.symbol} ${side(p)}  ${formatPrice(p.entryPrice)} → ${formatPrice(p.exitPrice)}  ${formatPct(p.gainPct)}  ${p.holdDays ?? "—"} days`),
      ...(s.opened.length ? [`  Opened: ${s.opened.map((p) => `${p.symbol} (${side(p)})`).join(", ")}`] : []),
      `Since inception: ${s.all.closed} closed, win rate ${rate(s.all.winRate)}, average ${formatPct(s.all.avgGain)}, median ${formatPct(s.all.medianGain)}. ${s.all.open} open, average open gain ${formatPct(s.all.avgOpenGain)}.`,
      "",
    ]),
    "Gains are computed from recorded entries and exits and from market prices, adjusted for splits. Past results do not promise future results.",
    ...(input.appUrl ? ["", `Open Track Record: ${input.appUrl}`] : []),
  ].join("\n");

  const cell = "padding:6px 8px;border-top:1px solid #e4e7ec;font-size:13px";
  const head = "padding:6px 8px;font-size:11px;text-transform:uppercase;color:#667085;text-align:left";
  const tone = (pct: number | null) => (pct == null ? "#667085" : pct > 0 ? "#067647" : pct < 0 ? "#b42318" : "#101828");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#101828">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(input.brandName)} – Weekly Performance Report</h1>
<p style="margin:0 0 16px;color:#667085;font-size:14px">Week ending ${iso(friday)} · ${closedThisWeek} closed · ${openedThisWeek} opened</p>
${list
  .map(
    (s) => `<div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin:0 0 12px">
<h2 style="font-size:16px;margin:0 0 6px">${escapeHtml(s.label)}</h2>
<p style="margin:0 0 8px;font-size:13px;color:#475467">This week: ${s.opened.length} opened, ${s.closed.length} closed${s.closed.length ? ` · win rate ${rate(s.week.winRate)} · average <span style="color:${tone(s.week.avgGain)};font-weight:600">${formatPct(s.week.avgGain)}</span>` : ""}</p>
${
  s.closed.length
    ? `<table style="width:100%;border-collapse:collapse"><tr><th style="${head}">Closed</th><th style="${head}">Symbol</th><th style="${head}">Entry → exit</th><th style="${head};text-align:right">Gain</th><th style="${head};text-align:right">Days</th></tr>
${s.closed
  .map(
    (p) =>
      `<tr><td style="${cell}">${p.exitDate ? iso(p.exitDate) : ""}</td><td style="${cell}"><strong>${escapeHtml(p.symbol)}</strong> ${side(p)}</td><td style="${cell}">${formatPrice(p.entryPrice)} → ${formatPrice(p.exitPrice)}</td><td style="${cell};text-align:right;color:${tone(p.gainPct)};font-weight:600">${formatPct(p.gainPct)}</td><td style="${cell};text-align:right">${p.holdDays ?? "—"}</td></tr>`,
  )
  .join("\n")}</table>`
    : ""
}
${s.opened.length ? `<p style="margin:8px 0 0;font-size:13px">Opened: ${s.opened.map((p) => `${escapeHtml(p.symbol)} (${side(p)})`).join(", ")}</p>` : ""}
<p style="margin:8px 0 0;font-size:12px;color:#667085">Since inception: ${s.all.closed} closed · win rate ${rate(s.all.winRate)} · average ${formatPct(s.all.avgGain)} · median ${formatPct(s.all.medianGain)} · ${s.all.open} open (average ${formatPct(s.all.avgOpenGain)})</p>
</div>`,
  )
  .join("\n")}
<p style="font-size:12px;color:#667085">Gains are computed from recorded entries and exits and from market prices, adjusted for splits. Past results do not promise future results.</p>
${input.appUrl ? `<p style="font-size:13px"><a href="${escapeHtml(input.appUrl)}" style="color:#2563eb">Open Track Record</a></p>` : ""}
</div></body></html>`;
  return { week, subject, text, html, closedThisWeek, openedThisWeek };
}
