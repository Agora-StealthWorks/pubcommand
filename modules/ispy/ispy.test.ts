import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  contentKey,
  copyNote,
  describeConditions,
  facetOptions,
  feedForNiche,
  feedsForOrg,
  findTranscriptLink,
  fingerprintCopy,
  firstMatchingRule,
  kindForViewer,
  liftType,
  matchCopy,
  matchPublisher,
  normalizeCopyExtraction,
  parseConditions,
  pageKeys,
  declaredUrls,
  previewRule,
  priceBucket,
  regexError,
  resolveUrl,
  senderFacts,
  sendKindFor,
  suggestListCategory,
  videoIds,
  type RoutingFacts,
  type RoutingRule,
} from "./index";

const BODY = Array.from({ length: 60 }, (_, i) => `sentence number ${i} talks about the ai wildcard company and its government contract`).join(". ");

describe("copy fingerprints", () => {
  it("matches the same body with a new subject, greeting, tracking links and footer", () => {
    const a = fingerprintCopy(`Dear Stephen,\n${BODY}\nhttps://click.example.com/abc?u=1\nTo unsubscribe click here. © 2026 Paradigm`);
    const b = fingerprintCopy(`Hi Jane,\n${BODY}\nhttps://click.example.com/xyz?u=2\nYou are receiving this because you signed up.`);
    expect(a.hash).toBe(b.hash);
    expect(matchCopy(b, [{ id: "c1", copyHash: a.hash, simhash: a.simhash, normalized: a.normalized }])).toEqual({ id: "c1", how: "exact", similarity: 1 });
  });

  it("matches the same body with an editor's note on top", () => {
    const a = fingerprintCopy(BODY);
    const b = fingerprintCopy(`Editor's note: my friend Jim has something important for you today. ${BODY}`);
    expect(a.hash).not.toBe(b.hash);
    expect(matchCopy(b, [{ id: "c1", copyHash: a.hash, simhash: a.simhash, normalized: a.normalized }])?.how).toBe("near");
  });

  it("does not match a genuinely different email", () => {
    const a = fingerprintCopy(BODY);
    const b = fingerprintCopy(Array.from({ length: 60 }, (_, i) => `paragraph ${i} explains why gold miners are cheap versus bullion right now`).join(". "));
    expect(matchCopy(b, [{ id: "c1", copyHash: a.hash, simhash: a.simhash, normalized: a.normalized }])).toBeNull();
  });

  it("matches by campaign id when the body changed", () => {
    const b = fingerprintCopy("short");
    expect(matchCopy(b, [], "c9")).toEqual({ id: "c9", how: "campaign", similarity: 1 });
  });
});

describe("landing pages", () => {
  it("drops per-send noise from canonical keys", () => {
    expect(canonicalKey("https://www.brownstoneresearch.com/ai5/?utm_source=x&email=a@b.com&caid=7")).toBe("brownstoneresearch.com/ai5?caid=7");
  });

  it("finds a transcript link in the footer", () => {
    const html = `<html><body><h1>Big</h1><footer><a href="/privacy">Privacy</a> <a href="https://click.x.com/r?url=https%3A%2F%2Fpromo.com%2Fai5%2Ftranscript">Prefer to read? Click here for the transcript</a></footer></body></html>`;
    expect(findTranscriptLink(html, "https://promo.com/ai5")).toEqual({ url: "https://promo.com/ai5/transcript", text: "Prefer to read? Click here for the transcript" });
  });

  it("returns null when no transcript is linked", () => {
    expect(findTranscriptLink(`<a href="/order">Order now</a><a href="/terms">Terms</a>`, "https://promo.com/")).toBeNull();
  });

  it("reads canonical urls and video ids", () => {
    const html = `<link rel="canonical" href="https://promo.com/ai5"><meta property="og:url" content="/ai5?x=1"><iframe src="https://fast.wistia.net/embed/iframe/abc12345"></iframe>`;
    const declared = declaredUrls(html, "https://promo.com/ai5/X2996AFL");
    expect(declared.relCanonical).toBe("https://promo.com/ai5");
    expect(pageKeys("https://promo.com/ai5/X2996AFL", declared)).toContain("promo.com/ai5");
    expect(videoIds(html, "https://promo.com/ai5")).toContain("wistia:abc12345");
  });

  it("content key joins per-send URLs that carry the same headline", () => {
    const k = (host: string) => contentKey({ rootDomain: "oxfordclub.com", host, headline: "The Retirement Income Secret Wall Street Hides", headlineSource: "PAGE_H1", siteName: null, isPlatform: false });
    expect(k("signup.oxfordclub.com")).toBe(k("www.oxfordclub.com"));
  });

  it("follows client-side redirects through the injected fetch", async () => {
    const pages: Record<string, { finalUrl: string; status: number; html: string | null; hops: number }> = {
      "https://t.co/1": { finalUrl: "https://mid.com/", status: 200, html: `<meta http-equiv="refresh" content="0;url=https://promo.com/ai5">`, hops: 2 },
      "https://promo.com/ai5": { finalUrl: "https://promo.com/ai5", status: 200, html: "<h1>Hello there world</h1>", hops: 0 },
    };
    const res = await resolveUrl("https://t.co/1", async (url) => pages[url] ?? { finalUrl: url, status: 404, html: null, hops: 0 });
    expect(res.finalUrl).toBe("https://promo.com/ai5");
    expect(res.hops).toBe(3);
  });
});

describe("routing rules", () => {
  const facts: RoutingFacts = {
    fromAddress: "vip@tradeoftheday.com",
    fromName: "Trade of the Day VIP",
    subject: "[TOTD VIP] Tuesday trade",
    masthead: "Trade of the Day",
    listIdHeader: "totd-vip.tradeoftheday.com",
    headers: { "x-campaign": "TOTD-1" },
    body: "hello",
    inboxAddress: "totd@spy.pubcommand.com",
    campaignId: "TOTD-1",
  };
  const rule = (id: string, priority: number, conditions: RoutingRule["conditions"], listId: string): RoutingRule => ({ id, priority, enabled: true, conditions, action: "ROUTE", listId, publisherId: null, publicationId: null });

  it("first match by priority wins", () => {
    const rules = [
      rule("b", 20, [{ field: "masthead", op: "contains", value: "trade of the day" }], "free"),
      rule("a", 10, [{ field: "subject", op: "matches", value: "^\\[TOTD VIP\\]" }], "vip"),
    ];
    expect(firstMatchingRule(facts, rules)?.listId).toBe("vip");
  });

  it("domain equals covers subdomains; bad regex never matches", () => {
    expect(firstMatchingRule(facts, [rule("a", 1, [{ field: "fromDomain", op: "equals", value: "tradeoftheday.com" }], "x")])).not.toBeNull();
    expect(regexError("([")).not.toBeNull();
    expect(firstMatchingRule(facts, [rule("a", 1, [{ field: "subject", op: "matches", value: "([" }], "x")])).toBeNull();
  });

  it("parses and describes conditions, and previews without changing anything", () => {
    const conditions = parseConditions([{ field: "fromAddress", op: "equals", value: " vip@tradeoftheday.com " }, { field: "nope", op: "equals", value: "x" }]);
    expect(conditions).toHaveLength(1);
    expect(describeConditions(conditions)).toBe("From address is “vip@tradeoftheday.com”");
    const emails = [{ id: "1", listId: "free", facts }, { id: "2", listId: "vip", facts }, { id: "3", listId: null, facts: { ...facts, fromAddress: "x@y.com" } }];
    const preview = previewRule({ conditions, listId: "vip", action: "ROUTE" }, emails);
    expect(preview.matched.map((e) => e.id)).toEqual(["1", "2"]);
    expect(preview.wouldMove.map((e) => e.id)).toEqual(["1"]);
  });
});

describe("classification", () => {
  it("matches publishers by address then longest domain", () => {
    const pubs = [
      { id: "a", fromAddresses: [], domains: ["example.com"], type: "COMPETITOR" },
      { id: "b", fromAddresses: [], domains: ["mb.example.com"], type: "COMPETITOR" },
      { id: "c", fromAddresses: ["x@mb.example.com"], domains: [], type: "INTERNAL" },
    ];
    expect(matchPublisher("y@news.mb.example.com", pubs)?.publisher.id).toBe("b");
    expect(matchPublisher("x@mb.example.com", pubs)?.publisher.id).toBe("c");
  });

  it("splits lifts into internal and external", () => {
    const totd = { publicationId: "totd", publisherId: "mta", groupId: "oxford" };
    expect(liftType(totd, { publicationId: "totd", publisherId: "mta", groupId: "oxford" })).toBe("PROMO");
    expect(liftType(totd, { publicationId: "communique", publisherId: "oxfordclub", groupId: "oxford" })).toBe("INTERNAL_LIFT");
    expect(liftType(totd, { publicationId: null, publisherId: "paradigm", groupId: "paradigm-group" })).toBe("EXTERNAL_LIFT");
    expect(liftType(totd, null)).toBeNull();
  });

  it("affiliate seeds and affiliate publishers are affiliate sends", () => {
    expect(sendKindFor({ affiliateSeed: true, publisherType: "COMPETITOR" })).toBe("AFFILIATE");
    expect(sendKindFor({ affiliateSeed: false, publisherType: "AFFILIATE" })).toBe("AFFILIATE");
    expect(sendKindFor({ affiliateSeed: false, publisherType: "INTERNAL" })).toBe("INTERNAL");
    expect(suggestListCategory("Elon's AI Summit", "x@y.com", "COMPETITOR")).toBe("HOTLIST");
    expect(suggestListCategory("MarketBeat", "x@y.com", "AFFILIATE")).toBe("MARKETING_FILE");
  });
});

describe("access", () => {
  it("feeds follow niche with overrides", () => {
    expect(feedForNiche("health")).toBe("HEALTH");
    expect(feedForNiche("general")).toBe("FINPUB");
    expect(feedsForOrg(["finance"], [{ feed: "HEALTH", mode: "ALLOWED" }])).toEqual(["FINPUB", "HEALTH"]);
    expect(feedsForOrg(["finance"], [{ feed: "FINPUB", mode: "BLOCKED" }])).toEqual([]);
  });

  it("an org's own publication is internal for it and external for others", () => {
    const email = { sendKind: "EXTERNAL", publisherLinkedOrgId: null, publicationLinkedOrgId: "mta" };
    expect(kindForViewer(email, "mta")).toBe("INTERNAL");
    expect(kindForViewer(email, "other")).toBe("EXTERNAL");
  });
});

describe("linked filters", () => {
  const reg = {
    publishers: [{ id: "mta", name: "MTA" }, { id: "st", name: "Stansberry" }],
    publications: [{ id: "totd", name: "Trade of the Day", publisherId: "mta" }, { id: "sd", name: "Stansberry Digest", publisherId: "st" }],
    lists: [
      { id: "free", name: "TOTD Free", publisherId: "mta", publicationId: "totd" },
      { id: "vip", name: "TOTD VIP", publisherId: "mta", publicationId: "totd" },
      { id: "sdl", name: "Digest", publisherId: "st", publicationId: "sd" },
    ],
    gurus: [
      { id: "karim", name: "Karim", publicationIds: ["totd"], listIds: ["free"], publisherId: "mta" },
      { id: "porter", name: "Porter", publicationIds: ["sd"], listIds: ["sdl"], publisherId: "st" },
    ],
  };
  it("a guru narrows lists and publications; a list narrows gurus", () => {
    const byGuru = facetOptions(reg, { guruId: "porter" });
    expect(byGuru.lists.map((l) => l.id)).toEqual(["sdl"]);
    expect(byGuru.publications.map((p) => p.id)).toEqual(["sd"]);
    expect(facetOptions(reg, { listId: "vip" }).gurus.map((g) => g.id)).toEqual(["karim"]);
    expect(facetOptions(reg, { publicationId: "totd" }).lists.map((l) => l.id)).toEqual(["free", "vip"]);
  });
});

describe("notes and headers", () => {
  it("writes a copy note with takeaways, offer, topics and sends", () => {
    const x = normalizeCopyExtraction({ typeHint: "lift", headline: "AI", takeaways: ["One", "Two", "Three"], offer: { product: "Strategic Intelligence", priceText: "$49 a year", discount: null, guarantee: null, cta: null }, topics: ["AI Stocks"], gurus: ["Jim"], promotedBrand: "Paradigm", promotedGuru: "Jim", hasEdNote: true, listName: null });
    const note = copyNote({ title: "AI", feed: "FINPUB", emailType: "EXTERNAL_LIFT", publisher: "Stansberry", advertiser: "Paradigm", extraction: x, sends: [{ date: new Date("2026-11-03"), list: "Pressroom", kind: "INTERNAL", subject: "Urgent" }, { date: new Date("2026-11-20"), list: "MarketBeat", kind: "AFFILIATE", subject: "AI | now" }], text: "Body" });
    expect(note.body).toContain("## Key takeaways");
    expect(note.body).toContain("“$49 a year” (as stated)");
    expect(note.body).toContain("ai stocks");
    expect(note.body).toContain("affiliates: MarketBeat");
    expect(note.body).toContain("| 2026-11-20 | MarketBeat | affiliate | AI / now |");
  });

  it("reads sender facts from headers and buckets prices", () => {
    const facts = senderFacts({ "list-id": "TOTD <totd-free.tradeoftheday.com>", "authentication-results": "mx; spf=pass; dkim=pass; dmarc=fail", "x-mailer": "SparkPost", "x-campaign": "TOTD-1", received: "from [192.0.2.41]" });
    expect(facts).toEqual({ espName: "SparkPost", campaignId: "TOTD-1", listIdHeader: "totd-free.tradeoftheday.com", authResults: { spf: "pass", dkim: "pass", dmarc: "fail" }, sendingIp: "192.0.2.41" });
    expect(priceBucket("$49 for your first year")).toBe("$20–$99 front-end");
    expect(priceBucket("FREE report")).toBe("Free report / lead-gen");
  });
});
