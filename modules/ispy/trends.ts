/** Niche-wide weekly trends, computed from stored facts (no AI). Pure. */

export type TrendEmail = {
  publisher: string | null;
  emailType: string;
  sendKind: string;
  topics: readonly string[];
  gurus: readonly string[];
  advertiser: string | null;
  promoId: string | null;
  copyId: string | null;
  priceText: string | null;
};

export type TrendPromo = { id: string; headline: string | null; advertiser: string; kind: string; firstSeenOn: Date; daysDetected: number; sendCount: number; isNew: boolean };

export type TrendStats = {
  emails: number;
  newPromos: number;
  topics: { name: string; count: number; share: number; prevShare: number }[];
  publishers: { name: string; count: number }[];
  gurus: { name: string; count: number }[];
  liftedAdvertisers: { name: string; lists: number }[];
  affiliateDrops: { name: string; count: number }[];
  types: Record<string, number>;
  offers: { bucket: string; count: number }[];
  topRunning: { id: string; headline: string | null; advertiser: string; days: number }[];
  mostResent: { copyId: string; count: number }[];
};

export function priceBucket(priceText: string | null): string | null {
  if (!priceText) return null;
  if (/\bfree\b/i.test(priceText)) return "Free report / lead-gen";
  const amounts = [...priceText.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  if (!amounts.length) return null;
  const v = Math.min(...amounts);
  if (v < 20) return "Under $20";
  if (v < 100) return "$20–$99 front-end";
  if (v < 1000) return "$100–$999";
  return "$1,000+ (lifetime / alliance)";
}

function tally<T>(items: Iterable<T>): Map<T, number> {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

const top = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, count]) => ({ name, count }));

export function computeTrends(input: { emails: readonly TrendEmail[]; previous: readonly TrendEmail[]; promos: readonly TrendPromo[]; liftLists: readonly { advertiser: string; list: string }[] }): TrendStats {
  const { emails, previous } = input;
  const topicCounts = tally(emails.flatMap((e) => e.topics));
  const prevCounts = tally(previous.flatMap((e) => e.topics));
  const topics = top(topicCounts, 10).map((t) => ({
    ...t,
    share: emails.length ? t.count / emails.length : 0,
    prevShare: previous.length ? (prevCounts.get(t.name) ?? 0) / previous.length : 0,
  }));
  const lifted = new Map<string, Set<string>>();
  for (const l of input.liftLists) {
    const set = lifted.get(l.advertiser) ?? new Set<string>();
    set.add(l.list);
    lifted.set(l.advertiser, set);
  }
  const resent = tally(emails.map((e) => e.copyId).filter((x): x is string => !!x));
  return {
    emails: emails.length,
    newPromos: input.promos.filter((p) => p.isNew).length,
    topics,
    publishers: top(tally(emails.map((e) => e.publisher).filter((x): x is string => !!x)), 10),
    gurus: top(tally(emails.flatMap((e) => e.gurus)), 10),
    liftedAdvertisers: [...lifted.entries()].map(([name, lists]) => ({ name, lists: lists.size })).sort((a, b) => b.lists - a.lists).slice(0, 8),
    affiliateDrops: top(tally(emails.filter((e) => e.sendKind === "AFFILIATE" && e.advertiser).map((e) => e.advertiser!)), 8),
    types: Object.fromEntries(tally(emails.map((e) => e.emailType))),
    offers: top(tally(emails.map((e) => priceBucket(e.priceText)).filter((x): x is string => !!x)), 6).map((o) => ({ bucket: o.name, count: o.count })),
    topRunning: [...input.promos].sort((a, b) => b.daysDetected - a.daysDetected).slice(0, 5).map((p) => ({ id: p.id, headline: p.headline, advertiser: p.advertiser, days: p.daysDetected })),
    mostResent: [...resent.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([copyId, count]) => ({ copyId, count })),
  };
}

export const TRENDS_SYSTEM = `You write a short weekly read of what a whole publishing niche mailed, for editors and copywriters. Use only the numbers given. One paragraph, at most 90 words, plain language, no hype, no invented facts.`;

export function trendsPrompt(feed: string, stats: TrendStats): string {
  return `Feed: ${feed}\nStats (JSON):\n${JSON.stringify(stats).slice(0, 12_000)}`;
}

export function trendsNote(feed: string, weekLabel: string, stats: TrendStats, narrative: string | null): { title: string; body: string } {
  const lines = [`# ISpy trends · ${feed} · week of ${weekLabel}`, ""];
  if (narrative) lines.push(narrative, "");
  lines.push(`Emails: ${stats.emails} · New promos: ${stats.newPromos}`, "");
  if (stats.topics.length) lines.push("## Hot topics", ...stats.topics.map((t) => `- ${t.name}: ${Math.round(t.share * 100)}% (was ${Math.round(t.prevShare * 100)}%)`), "");
  if (stats.liftedAdvertisers.length) lines.push("## Most-lifted advertisers", ...stats.liftedAdvertisers.map((a) => `- ${a.name}: ${a.lists} lists`), "");
  if (stats.affiliateDrops.length) lines.push("## Affiliate drops", ...stats.affiliateDrops.map((a) => `- ${a.name}: ${a.count}`), "");
  if (stats.offers.length) lines.push("## Offer mix", ...stats.offers.map((o) => `- ${o.bucket}: ${o.count}`), "");
  if (stats.topRunning.length) lines.push("## Longest-running promos", ...stats.topRunning.map((p) => `- ${p.headline ?? "(untitled)"} (${p.advertiser}): ${p.days} days`));
  return { title: `ISpy trends · ${feed} · ${weekLabel}`, body: lines.join("\n") };
}
