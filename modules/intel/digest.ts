/**
 * The weekly Promo Radar digest, posted to a Slack incoming webhook and/or
 * emailed to the team. Pure: message content and validation only.
 */
import { hostOf } from "./links";
import type { RadarNarrative, RadarSummary } from "./radar";
import { weekLabel } from "./radar";

/** Slack incoming webhooks live on one host; anything else is refused (we never post to arbitrary URLs). */
export function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && /^\/(services|triggers|workflows)\/[A-Za-z0-9/_-]{10,}$/.test(url.pathname) && !url.username && !url.port;
  } catch {
    return false;
  }
}

/** Show only the end of a stored webhook so the page never displays the secret. */
export function maskWebhook(value: string): string {
  const tail = value.trim().slice(-4);
  return `https://hooks.slack.com/…${tail}`;
}

export function parseDigestEmails(value: string, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of value.split(/[\s,;]+/)) {
    const address = piece.trim().toLowerCase();
    if (!/^[^\s@<>]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(address) || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
    if (out.length >= max) break;
  }
  return out;
}

export type DigestVideo = { title: string; competitorName: string | null; type: string | null; headline: string | null; url: string };

export type DigestInput = {
  brandName: string;
  summary: RadarSummary;
  narrative: RadarNarrative | null;
  radarUrl: string;
  videos?: readonly DigestVideo[];
  /** Promos listed in full; the rest are counted. */
  maxPromos?: number;
};

export type DigestContent = {
  subject: string;
  text: string;
  html: string;
  slack: { text: string; blocks: unknown[] };
};

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A URL safe inside Slack's <url|label> syntax. */
function slackUrl(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\|/g, "%7C");
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type PromoLine = { competitor: string; headline: string; isNew: boolean; sends: number; priceText: string | null; experts: string[]; landingUrl: string | null };

function promoLines(summary: RadarSummary): PromoLine[] {
  const lines: PromoLine[] = [];
  for (const group of summary.competitors) {
    for (const promo of group.promos) {
      lines.push({ competitor: group.name, headline: promo.headline, isNew: promo.isNew, sends: promo.sends, priceText: promo.priceText, experts: promo.experts, landingUrl: promo.landingUrl });
    }
  }
  return lines.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.sends - a.sends || a.competitor.localeCompare(b.competitor));
}

function detailBits(line: PromoLine): string[] {
  return [
    line.isNew ? "new" : null,
    line.sends > 1 ? `${line.sends} sends` : null,
    line.priceText ? `price as stated: ${line.priceText}` : null,
    line.experts.length ? line.experts.join(", ") : null,
  ].filter((bit): bit is string => Boolean(bit));
}

/** The digest in three shapes: Slack (mrkdwn blocks), email HTML and plain text. */
export function buildDigest(input: DigestInput): DigestContent {
  const { summary, narrative } = input;
  const week = weekLabel(new Date(`${summary.weekStart}T00:00:00Z`));
  const subject = `Promo Radar for ${input.brandName}: ${week}`;
  const totals = `${summary.totals.emails} competitor email${summary.totals.emails === 1 ? "" : "s"} from ${summary.totals.competitors} sender${summary.totals.competitors === 1 ? "" : "s"}, ${summary.totals.promos} distinct promo${summary.totals.promos === 1 ? "" : "s"} (${summary.totals.newPromos} new).`;
  const max = input.maxPromos ?? 10;
  const promos = promoLines(summary);
  const shown = promos.slice(0, max);
  const more = promos.length - shown.length;
  const angles = summary.angles.slice(0, 6);
  const videos = (input.videos ?? []).slice(0, 8);

  // Plain text
  const text: string[] = [subject, "", totals];
  if (narrative?.overview) text.push("", narrative.overview);
  if (shown.length) {
    text.push("", "Promos:");
    for (const line of shown) {
      const bits = detailBits(line);
      text.push(`- ${line.competitor}: ${line.headline}${bits.length ? ` (${bits.join("; ")})` : ""}${line.landingUrl ? ` ${line.landingUrl}` : ""}`);
    }
    if (more > 0) text.push(`…and ${more} more.`);
  }
  if (angles.length) text.push("", `Recurring angles: ${angles.map((angle) => `${angle.angle} (${angle.competitors.length})`).join(", ")}.`);
  if (narrative?.watch.length) {
    text.push("", "Worth watching:");
    for (const item of narrative.watch) text.push(`- ${item}`);
  }
  if (videos.length) {
    text.push("", "Videos captured this week:");
    for (const video of videos) text.push(`- ${video.competitorName ? `${video.competitorName}: ` : ""}${video.headline ?? video.title} ${video.url}`);
  }
  text.push("", `Open the radar: ${input.radarUrl}`, "", "Competitors' claims and prices are as they stated them.");

  // Slack
  const slackPromo = (line: PromoLine) => {
    const bits = detailBits(line);
    const link = line.landingUrl ? ` <${slackUrl(line.landingUrl)}|${slackEscape(hostOf(line.landingUrl) ?? "page")}>` : "";
    return `• *${slackEscape(line.competitor)}*: ${slackEscape(line.headline)}${bits.length ? ` _(${slackEscape(bits.join("; "))})_` : ""}${link}`;
  };
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: subject.slice(0, 150) } },
    { type: "section", text: { type: "mrkdwn", text: slackEscape(totals) + (narrative?.overview ? `\n\n${slackEscape(narrative.overview)}` : "") } },
  ];
  if (shown.length) {
    const body = shown.map(slackPromo).join("\n") + (more > 0 ? `\n…and ${more} more.` : "");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Promos*\n${body}`.slice(0, 2900) } });
  }
  if (angles.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Recurring angles:* ${slackEscape(angles.map((angle) => `${angle.angle} (${angle.competitors.length})`).join(", "))}` } });
  }
  if (narrative?.watch.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Worth watching*\n${narrative.watch.map((item) => `• ${slackEscape(item)}`).join("\n")}`.slice(0, 2900) } });
  }
  if (videos.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Videos captured*\n${videos.map((video) => `• <${slackUrl(video.url)}|${slackEscape((video.headline ?? video.title).slice(0, 120))}>${video.competitorName ? ` (${slackEscape(video.competitorName)})` : ""}`).join("\n")}`.slice(0, 2900) },
    });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${slackUrl(input.radarUrl)}|Open the radar> · Competitors' claims and prices are as they stated them.` }] });

  // Email HTML
  const h = htmlEscape;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#101828;max-width:640px">`,
    `<h2 style="margin:0 0 8px">${h(subject)}</h2>`,
    `<p style="margin:0 0 12px;color:#475467">${h(totals)}</p>`,
    narrative?.overview ? `<p style="margin:0 0 16px">${h(narrative.overview)}</p>` : "",
    shown.length
      ? `<h3 style="margin:16px 0 6px">Promos</h3><ul style="padding-left:18px;margin:0">${shown
          .map((line) => {
            const bits = detailBits(line);
            const link = line.landingUrl ? ` <a href="${h(line.landingUrl)}" style="color:#1d4ed8">${h(hostOf(line.landingUrl) ?? "page")}</a>` : "";
            return `<li style="margin:0 0 6px"><strong>${h(line.competitor)}</strong>: ${h(line.headline)}${bits.length ? ` <span style="color:#475467">(${h(bits.join("; "))})</span>` : ""}${link}</li>`;
          })
          .join("")}</ul>${more > 0 ? `<p style="margin:4px 0 0;color:#475467">…and ${more} more.</p>` : ""}`
      : "",
    angles.length ? `<p style="margin:16px 0 0"><strong>Recurring angles:</strong> ${h(angles.map((angle) => `${angle.angle} (${angle.competitors.length})`).join(", "))}</p>` : "",
    narrative?.watch.length ? `<h3 style="margin:16px 0 6px">Worth watching</h3><ul style="padding-left:18px;margin:0">${narrative.watch.map((item) => `<li>${h(item)}</li>`).join("")}</ul>` : "",
    videos.length
      ? `<h3 style="margin:16px 0 6px">Videos captured this week</h3><ul style="padding-left:18px;margin:0">${videos
          .map((video) => `<li><a href="${h(video.url)}" style="color:#1d4ed8">${h(video.headline ?? video.title)}</a>${video.competitorName ? ` (${h(video.competitorName)})` : ""}</li>`)
          .join("")}</ul>`
      : "",
    `<p style="margin:20px 0 0"><a href="${h(input.radarUrl)}" style="color:#1d4ed8;font-weight:600">Open the radar</a></p>`,
    `<p style="margin:12px 0 0;font-size:12px;color:#667085">Competitors' claims and prices are as they stated them. You get this because your team turned on the Promo Radar digest in Intel settings.</p>`,
    `</div>`,
  ].join("");

  return { subject, text: text.join("\n"), html, slack: { text: `${subject}. ${totals}`, blocks } };
}
