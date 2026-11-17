/**
 * Promo Radar: the weekly digest of what competitors promoted. The grouping is
 * deterministic (counts and lists come from stored emails, never from the AI);
 * the AI only writes a short read of the recurring angles on top of it.
 */
import { isCommercial, type EmailExtraction, type EmailType } from "./extraction";
import { hostOf } from "./links";

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week that contains `date`. */
export function weekStartOf(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

export function weekEndOf(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * DAY_MS);
}

/** "2026-11-16" → that week's Monday, or null when it is not a date. */
export function parseWeek(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : weekStartOf(date);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart.getTime() + 6 * DAY_MS);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
}

export type RadarEmail = {
  id: string;
  competitorId: string | null;
  competitorName: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  extraction: EmailExtraction | null;
};

export type RadarPromo = {
  key: string;
  headline: string;
  product: string | null;
  offer: string | null;
  priceText: string | null;
  experts: string[];
  landingUrl: string | null;
  angles: string[];
  emailIds: string[];
  sends: number;
  firstSent: string;
  /** Not seen in any earlier week. */
  isNew: boolean;
};

export type RadarCompetitor = {
  key: string;
  competitorId: string | null;
  name: string;
  emails: number;
  types: Partial<Record<EmailType | "unclassified", number>>;
  promos: RadarPromo[];
};

export type RadarAngle = { angle: string; count: number; competitors: string[] };

export type RadarSummary = {
  weekStart: string;
  weekEnd: string;
  totals: { emails: number; classified: number; promos: number; newPromos: number; competitors: number };
  competitors: RadarCompetitor[];
  /** Angles used at least twice, or by at least two competitors. */
  angles: RadarAngle[];
};

function normalizeKeyText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * One promo can go out many times with different tracking links and subject
 * lines. Its key is the landing page (host + path) when we have one, else the
 * product, else the headline.
 */
export function promoKey(input: { extraction: EmailExtraction; subject: string; competitorKey: string }): string {
  const landing = input.extraction.landingUrl;
  if (landing) {
    try {
      const url = new URL(landing);
      return `url:${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      // fall through
    }
  }
  if (input.extraction.product) return `product:${input.competitorKey}:${normalizeKeyText(input.extraction.product)}`;
  return `headline:${input.competitorKey}:${normalizeKeyText(input.extraction.headline ?? input.subject)}`;
}

export function competitorKeyOf(email: Pick<RadarEmail, "competitorId" | "fromAddress">): string {
  if (email.competitorId) return `c:${email.competitorId}`;
  return `d:${(email.fromAddress.split("@")[1] ?? email.fromAddress).toLowerCase()}`;
}

/** Group one week's emails by competitor and promo. `earlierPromoKeys` are keys seen before this week. */
export function buildRadar(input: { weekStart: Date; emails: readonly RadarEmail[]; earlierPromoKeys: ReadonlySet<string> }): RadarSummary {
  const start = input.weekStart.getTime();
  const end = weekEndOf(input.weekStart).getTime();
  const week = input.emails
    .filter((email) => email.receivedAt.getTime() >= start && email.receivedAt.getTime() < end)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id));

  const competitors = new Map<string, RadarCompetitor & { promoMap: Map<string, RadarPromo> }>();
  const angleCounts = new Map<string, { count: number; competitors: Set<string> }>();
  let classified = 0;

  for (const email of week) {
    const key = competitorKeyOf(email);
    const name = email.competitorName ?? `Unmatched: ${email.fromAddress.split("@")[1] ?? email.fromAddress}`;
    let group = competitors.get(key);
    if (!group) {
      group = { key, competitorId: email.competitorId, name, emails: 0, types: {}, promos: [], promoMap: new Map() };
      competitors.set(key, group);
    }
    group.emails += 1;
    const type = email.extraction?.type ?? "unclassified";
    group.types[type] = (group.types[type] ?? 0) + 1;
    if (!email.extraction) continue;
    classified += 1;
    if (!isCommercial(email.extraction.type)) continue;

    for (const angle of email.extraction.angles) {
      const entry = angleCounts.get(angle) ?? { count: 0, competitors: new Set<string>() };
      entry.count += 1;
      entry.competitors.add(name);
      angleCounts.set(angle, entry);
    }

    const pKey = promoKey({ extraction: email.extraction, subject: email.subject, competitorKey: key });
    const existing = group.promoMap.get(pKey);
    if (existing) {
      existing.sends += 1;
      existing.emailIds.push(email.id);
      for (const angle of email.extraction.angles) if (!existing.angles.includes(angle)) existing.angles.push(angle);
      for (const expert of email.extraction.experts) if (!existing.experts.includes(expert)) existing.experts.push(expert);
      existing.product ??= email.extraction.product;
      existing.offer ??= email.extraction.offer;
      existing.priceText ??= email.extraction.priceText;
      continue;
    }
    group.promoMap.set(pKey, {
      key: pKey,
      headline: email.extraction.headline ?? email.subject,
      product: email.extraction.product,
      offer: email.extraction.offer,
      priceText: email.extraction.priceText,
      experts: [...email.extraction.experts],
      landingUrl: email.extraction.landingUrl,
      angles: [...email.extraction.angles],
      emailIds: [email.id],
      sends: 1,
      firstSent: isoDay(email.receivedAt),
      isNew: !input.earlierPromoKeys.has(pKey),
    });
  }

  const groups: RadarCompetitor[] = [...competitors.values()]
    .map(({ promoMap, ...group }) => ({
      ...group,
      promos: [...promoMap.values()].sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.sends - a.sends || a.firstSent.localeCompare(b.firstSent)),
    }))
    .sort((a, b) => b.promos.length - a.promos.length || b.emails - a.emails || a.name.localeCompare(b.name));

  const angles: RadarAngle[] = [...angleCounts.entries()]
    .map(([angle, entry]) => ({ angle, count: entry.count, competitors: [...entry.competitors].sort() }))
    .filter((entry) => entry.count >= 2 || entry.competitors.length >= 2)
    .sort((a, b) => b.competitors.length - a.competitors.length || b.count - a.count || a.angle.localeCompare(b.angle));

  const promos = groups.reduce((sum, group) => sum + group.promos.length, 0);
  const newPromos = groups.reduce((sum, group) => sum + group.promos.filter((promo) => promo.isNew).length, 0);
  return {
    weekStart: isoDay(input.weekStart),
    weekEnd: isoDay(new Date(end - DAY_MS)),
    totals: { emails: week.length, classified, promos, newPromos, competitors: groups.length },
    competitors: groups,
    angles,
  };
}

// ── AI read of the week ─────────────────────────────────────────────────────

export type RadarNarrative = {
  overview: string;
  themes: { angle: string; competitors: string[]; note: string }[];
  watch: string[];
};

export const RADAR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "themes", "watch"],
  properties: {
    overview: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["angle", "competitors", "note"],
        properties: {
          angle: { type: "string" },
          competitors: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
      },
    },
    watch: { type: "array", items: { type: "string" } },
  },
} as const;

export const RADAR_SYSTEM = `You write the weekly Promo Radar for a newsletter publisher's editors and copywriters: a short read of what competing publishers promoted this week.

You get the week's promos grouped by competitor, with the angles each one used. Write:
- overview: three or four sentences on what the competition pushed this week and how.
- themes: up to five recurring angles or offer patterns, each with the competitors using it and one sentence on how they used it.
- watch: up to five short, practical things our team should watch or test, phrased as suggestions.

Rules: use only the promos provided. Never invent a competitor, product, price, result or statistic, and never add a number that is not in the data. Describe competitors' claims as their claims. Follow the brand's compliance rules.`;

export function radarPrompt(input: { brandContext: string; summary: RadarSummary }): string {
  const lines: string[] = [
    "Our brand:",
    input.brandContext,
    "",
    `Week: ${input.summary.weekStart} to ${input.summary.weekEnd}. ${input.summary.totals.emails} competitor emails, ${input.summary.totals.promos} distinct promos (${input.summary.totals.newPromos} new).`,
    "",
  ];
  for (const group of input.summary.competitors) {
    if (!group.promos.length) continue;
    lines.push(`## ${group.name} (${group.emails} emails)`);
    for (const promo of group.promos.slice(0, 12)) {
      const bits = [
        promo.isNew ? "NEW" : "returning",
        `${promo.sends} send${promo.sends === 1 ? "" : "s"}`,
        promo.product ? `product: ${promo.product}` : null,
        promo.priceText ? `price as stated: ${promo.priceText}` : null,
        promo.experts.length ? `expert: ${promo.experts.join(", ")}` : null,
        promo.angles.length ? `angles: ${promo.angles.join(", ")}` : null,
        hostOf(promo.landingUrl) ? `landing: ${hostOf(promo.landingUrl)}` : null,
      ].filter(Boolean);
      lines.push(`- "${promo.headline}" (${bits.join("; ")})`);
    }
    lines.push("");
  }
  if (input.summary.angles.length) {
    lines.push("Recurring angles this week:");
    for (const angle of input.summary.angles) lines.push(`- ${angle.angle}: ${angle.count} sends, ${angle.competitors.join(", ")}`);
  }
  return lines.join("\n");
}

export function normalizeNarrative(raw: RadarNarrative): RadarNarrative {
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return {
    overview: text(raw.overview, 1500),
    themes: (Array.isArray(raw.themes) ? raw.themes : [])
      .slice(0, 5)
      .map((theme) => ({
        angle: text(theme.angle, 80),
        competitors: (Array.isArray(theme.competitors) ? theme.competitors : []).map((name) => text(name, 120)).filter(Boolean).slice(0, 8),
        note: text(theme.note, 400),
      }))
      .filter((theme) => theme.angle),
    watch: (Array.isArray(raw.watch) ? raw.watch : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 5),
  };
}

/** The Brain note for one week's radar. */
export function radarBrainNote(input: { brandName: string; summary: RadarSummary; narrative: RadarNarrative | null }): { title: string; body: string } {
  const { summary, narrative } = input;
  const lines: string[] = [
    `Promo Radar for ${input.brandName}, week of ${summary.weekStart}. ${summary.totals.emails} competitor emails, ${summary.totals.promos} distinct promos, ${summary.totals.newPromos} new.`,
    "",
  ];
  if (narrative?.overview) lines.push(narrative.overview, "");
  for (const group of summary.competitors) {
    if (!group.promos.length) continue;
    lines.push(`## ${group.name}`);
    for (const promo of group.promos) {
      const extras = [promo.isNew ? "new" : "returning", promo.product, promo.priceText ? `price as stated: ${promo.priceText}` : null, promo.experts.join(", ") || null, promo.angles.join(", ") || null].filter(Boolean);
      lines.push(`- ${promo.headline} (${extras.join("; ")})`);
    }
    lines.push("");
  }
  if (summary.angles.length) {
    lines.push("## Recurring angles");
    for (const angle of summary.angles) lines.push(`- ${angle.angle}: ${angle.count} sends (${angle.competitors.join(", ")})`);
    lines.push("");
  }
  if (narrative?.themes.length) {
    lines.push("## Themes");
    for (const theme of narrative.themes) lines.push(`- **${theme.angle}** (${theme.competitors.join(", ")}): ${theme.note}`);
    lines.push("");
  }
  if (narrative?.watch.length) {
    lines.push("## Worth watching");
    for (const item of narrative.watch) lines.push(`- ${item}`);
  }
  return { title: `Promo Radar: week of ${summary.weekStart}`, body: lines.join("\n").trim() };
}
