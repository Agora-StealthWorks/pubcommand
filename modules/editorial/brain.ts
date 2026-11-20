/** Short Brain notes for saved calendar items. Facts only, as people entered them. */
import { fmtDayFull, fmtTime } from "./dates";

const line = (label: string, value: string | number | null | undefined) =>
  value == null || value === "" ? null : `- **${label}:** ${value}`;

export function issueBrainNote(issue: {
  title: string;
  publicationCode: string;
  publicationName: string | null;
  mailDate: string | null;
  status: string;
  issueType: string | null;
  writer: string | null;
  subjectLines: string[];
  offer: string | null;
  notes: string | null;
  stats: { delivered: number | null; openRate: number | null; clickRate: number | null; revenue: number | null } | null;
}): { title: string; body: string } {
  const pct = (v: number | null) => (v == null ? null : `${(v * 100).toFixed(2)}%`);
  const lines = [
    `Editorial issue on the Calendar.`,
    "",
    line("Publication", issue.publicationName ? `${issue.publicationName} (${issue.publicationCode})` : issue.publicationCode),
    line("Mail date", issue.mailDate ? fmtDayFull(issue.mailDate) : "Not scheduled"),
    line("Status", issue.status),
    line("Type", issue.issueType),
    line("Writer", issue.writer),
    line("Subject lines", issue.subjectLines.length ? issue.subjectLines.join(" | ") : null),
    line("Offer", issue.offer),
    issue.stats ? line("Mailed", issue.stats.delivered?.toLocaleString("en-US")) : null,
    issue.stats ? line("Open rate", pct(issue.stats.openRate)) : null,
    issue.stats ? line("Click rate", pct(issue.stats.clickRate)) : null,
    issue.stats && issue.stats.revenue != null ? line("Revenue", `$${issue.stats.revenue.toLocaleString("en-US")}`) : null,
    issue.notes ? `\n${issue.notes.trim().slice(0, 1200)}` : null,
  ].filter((l): l is string => l != null);
  return { title: `Issue: ${issue.title}`.slice(0, 180), body: lines.join("\n") };
}

export function eventBrainNote(event: {
  name: string;
  stage: string;
  eventType: string | null;
  format: string | null;
  marketingStart: string | null;
  eventDate: string | null;
  eventEnd: string | null;
  marketingEnd: string | null;
  startTime: string | null;
  channels: string[];
  hosts: string[];
  offer: string | null;
  notes: string | null;
  recurring: boolean;
  metrics: { peakAttendance: number | null; registrations: number | null; orders: number | null; revenue: number | null };
}): { title: string; body: string } {
  const when = event.eventDate
    ? `${fmtDayFull(event.eventDate)}${event.eventEnd && event.eventEnd !== event.eventDate ? ` to ${fmtDayFull(event.eventEnd)}` : ""}${event.startTime ? ` at ${fmtTime(event.startTime)}` : ""}`
    : "Not scheduled";
  const lines = [
    `Live event on the Calendar${event.recurring ? " (recurring)" : ""}.`,
    "",
    line("When", when),
    line("Marketing window", event.marketingStart || event.marketingEnd ? `${fmtDayFull(event.marketingStart)} to ${fmtDayFull(event.marketingEnd)}` : null),
    line("Stage", event.stage),
    line("Type", [event.eventType, event.format].filter(Boolean).join(" · ") || null),
    line("Channels", event.channels.join(", ") || null),
    line("Hosts", event.hosts.join(", ") || null),
    line("Offer", event.offer),
    line("Peak attendance", event.metrics.peakAttendance),
    line("Registrations", event.metrics.registrations),
    line("Orders", event.metrics.orders),
    event.metrics.revenue != null ? line("Revenue", `$${event.metrics.revenue.toLocaleString("en-US")}`) : null,
    event.notes ? `\n${event.notes.trim().slice(0, 1200)}` : null,
  ].filter((l): l is string => l != null);
  return { title: `Event: ${event.name}`.slice(0, 180), body: lines.join("\n") };
}

/** A finished CUB round: averaged, anonymous scores only. No reviewer names. */
export function cubBrainNote(round: {
  promoName: string;
  dueAt: string;
  count: number;
  averages: { label: string; value: number | null }[];
  overall: number | null;
}): { title: string; body: string } {
  const lines = [
    `CUB peer-review round on a promo draft (Calendar).`,
    "",
    line("Deadline", round.dueAt),
    line("Revisions received", round.count),
    ...round.averages.map((a) => line(`Average ${a.label.toLowerCase()} (0-10)`, a.value == null ? null : a.value.toFixed(1))),
    line("Average of all four (0-10)", round.overall == null ? null : round.overall.toFixed(1)),
  ].filter((l): l is string => l != null);
  return { title: `CUB round: ${round.promoName}`.slice(0, 180), body: lines.join("\n") };
}

/** A calendar promo: what it is, who writes it and when it launches. */
export function promoBrainNote(promo: {
  name: string;
  stage: string;
  promoType: string | null;
  format: string | null;
  product: string | null;
  writers: string[];
  gurus: string[];
  launchDate: string | null;
  launchEstimated: boolean;
  targetedDate: string | null;
  notes: string | null;
}): { title: string; body: string } {
  const lines = [
    `Promo on the Calendar's promo pipeline.`,
    "",
    line("Stage", promo.stage),
    line("Type", [promo.promoType, promo.format].filter(Boolean).join(" · ") || null),
    line("Publication", promo.product),
    line("Editors", promo.gurus.join(", ") || null),
    line("Copywriters", promo.writers.join(", ") || null),
    line("Launch", promo.launchDate ? `${fmtDayFull(promo.launchDate)}${promo.launchEstimated ? " (estimate)" : ""}` : null),
    line("Targeted", promo.targetedDate ? fmtDayFull(promo.targetedDate) : null),
    promo.notes ? `\n${promo.notes.trim().slice(0, 1200)}` : null,
  ].filter((l): l is string => l != null);
  return { title: `Promo: ${promo.name}`.slice(0, 180), body: lines.join("\n") };
}
