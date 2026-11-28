import { describe, expect, it } from "vitest";
import {
  buildAuthUrl,
  decryptToken,
  encryptToken,
  gmailClient,
  planSync,
  placementFromLabels,
  signState,
  verifyState,
  type FetchLike,
} from "./gmail";
import { emailBrainNote, normalizeExtraction, type EmailExtraction } from "./extraction";
import { looksLikeRawSource, preparePaste, prepareUpload } from "./ingest";
import { extractLinks, guessLandingUrl, unwrapTrackingUrl } from "./links";
import { manifest } from "./manifest";
import { matchCompetitor, normalizeCompetitorInput, normalizeDomain } from "./match";
import { decodeEncodedWords, htmlToText, parseAddress, parseEml, splitMbox } from "./mime";
import { buildRadar, promoKey, radarBrainNote, weekStartOf, type RadarEmail } from "./radar";

const CRLF = (lines: string[]) => lines.join("\r\n");

const MULTIPART = CRLF([
  "Return-Path: <bounce@mail.northwind.example>",
  "From: =?UTF-8?Q?Dr=2E_Ana_P=C3=A9rez?= <ana@mail.northwind.example>",
  "To: watcher@ourbrand.example",
  "Subject: =?UTF-8?B?VGhlIDMtbWludXRlIG1vcm5pbmcgaGFiaXQg4pyF?=",
  "  =?UTF-8?Q?_doctors_ignore?=",
  "Date: Tue, 10 Nov 2026 14:05:00 +0000 (UTC)",
  "Message-ID: <ABC123@northwind.example>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mixed-1"',
  "",
  "This is a multi-part message.",
  "--mixed-1",
  'Content-Type: multipart/related; boundary="rel-1"',
  "",
  "--rel-1",
  'Content-Type: multipart/alternative; boundary="alt-1"',
  "",
  "--alt-1",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Caf=C3=A9 readers: try this today. Long line that wraps with a soft=",
  " break.",
  "--alt-1",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(
    '<html><body><p>Café readers</p><img src="cid:logo@x"><a href="https://click.example/t?url=https%3A%2F%2Foffer.northwind.example%2Fhabit%3Fsrc%3Dem">Watch now</a> <a href="https://offer.northwind.example/habit?src=em2">Yes!</a><a href="https://northwind.example/unsubscribe?id=1">Unsubscribe</a></body></html>',
  ).toString("base64"),
  "--alt-1--",
  "--rel-1",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo@x>",
  "",
  Buffer.from([137, 80, 78, 71]).toString("base64"),
  "--rel-1--",
  "--mixed-1",
  "Content-Type: application/pdf; name*=UTF-8''r%C3%A9sum%C3%A9.pdf",
  "Content-Disposition: attachment",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4").toString("base64"),
  "--mixed-1--",
  "",
]);

describe("manifest", () => {
  it("keeps the module contract", () => {
    expect(manifest.id).toBe("intel");
    expect(manifest.nav[0]).toMatchObject({ href: "/ispy", permission: "intel.read" });
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["intel.read", "intel.write"]);
  });
});

describe(".eml parser", () => {
  it("reads headers, nested multipart bodies, charsets, inline images and attachments", () => {
    const parsed = parseEml(new Uint8Array(Buffer.from(MULTIPART, "latin1")));
    expect(parsed.subject).toBe("The 3-minute morning habit ✅ doctors ignore");
    expect(parsed.from).toEqual({ name: "Dr. Ana Pérez", address: "ana@mail.northwind.example" });
    expect(parsed.to).toBe("watcher@ourbrand.example");
    expect(parsed.date?.toISOString()).toBe("2026-11-10T14:05:00.000Z");
    expect(parsed.messageId).toBe("ABC123@northwind.example");
    expect(parsed.text).toBe("Café readers: try this today. Long line that wraps with a soft break.");
    expect(parsed.html).toContain("<p>Café readers</p>");
    expect(parsed.html).toContain('src="data:image/png;base64,');
    expect(parsed.html).not.toContain("cid:logo@x");
    expect(parsed.attachments.map((file) => file.filename)).toEqual(["inline-logo@x", "résumé.pdf"]);
    expect(parsed.attachments[1]).toMatchObject({ contentType: "application/pdf", size: 8 });
  });

  it("decodes Latin-1 bodies and falls back to text from HTML", () => {
    const raw = CRLF([
      "From: news@harbor.example",
      "Subject: =?iso-8859-1?Q?Derni=E8re_chance?=",
      "Content-Type: text/html; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<style>p{color:red}</style><p>Derni=E8re chance&nbsp;!</p><ul><li>Un</li><li>Deux</li></ul>",
    ]);
    const parsed = parseEml(new Uint8Array(Buffer.from(raw, "latin1")));
    expect(parsed.subject).toBe("Dernière chance");
    expect(parsed.from).toEqual({ name: null, address: "news@harbor.example" });
    expect(parsed.text).toBe("Dernière chance !\n• Un\n• Deux");
    expect(parsed.date).toBeNull();
  });

  it("parses address forms and adjacent encoded words", () => {
    expect(parseAddress('"Smith, Jane" <Jane@Example.com>')).toEqual({ name: "Smith, Jane", address: "jane@example.com" });
    expect(parseAddress("jane@example.com (Jane)")).toEqual({ name: "Jane", address: "jane@example.com" });
    expect(parseAddress("nobody")).toBeNull();
    expect(decodeEncodedWords("=?utf-8?q?a?= =?utf-8?q?b?= c")).toBe("ab c");
    expect(htmlToText("<p>One</p><p>Two &amp; three</p>")).toBe("One\nTwo & three");
  });

  it("never throws on junk", () => {
    const parsed = parseEml("not an email at all");
    expect(parsed.subject).toBe("(no subject)");
    expect(parsed.from).toBeNull();
  });
});

describe(".mbox parser", () => {
  const mbox = [
    "From 1789@xxx Tue Nov 10 14:05:00 +0000 2026",
    "X-Gmail-Labels: Inbox,Category Promotions",
    "From: A <a@one.example>",
    "Subject: First",
    "Message-ID: <one@one.example>",
    "",
    "Hello",
    ">From the desk of the editor",
    "",
    "From 1790@xxx Wed Nov 11 09:00:00 +0000 2026",
    "From: b@two.example",
    "Subject: Second",
    "",
    "Body two",
    "",
  ].join("\n");

  it("splits messages and un-escapes >From lines", () => {
    const messages = splitMbox(mbox);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("From the desk of the editor");
    expect(messages[0]).not.toContain(">From");
    expect(messages[1]).toContain("Subject: Second");
  });

  it("prepares every message of an upload with dedupe keys", () => {
    const result = prepareUpload(new Uint8Array(Buffer.from(mbox)), "takeout.mbox", new Date("2026-11-12T00:00:00Z"));
    expect(result.emails.map((email) => email.subject)).toEqual(["First", "Second"]);
    expect(result.emails[0]!.dedupeKey).toBe("mid:one@one.example");
    expect(result.emails[1]!.dedupeKey).toMatch(/^sha:[0-9a-f]{64}$/);
    expect(result.emails[0]!.headers["x-gmail-labels"]).toBe("Inbox,Category Promotions");
    expect(result.emails[1]!.receivedAt.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("treats a single .eml upload as one message", () => {
    const result = prepareUpload(new Uint8Array(Buffer.from(MULTIPART, "latin1")), "promo.eml");
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0]!.landingUrl).toBe("https://offer.northwind.example/habit?src=em");
  });
});

describe("paste", () => {
  it("parses full sources and wraps bodies typed with fields", () => {
    expect(looksLikeRawSource("From: a@b.example\nSubject: Hi\n\nBody")).toBe(true);
    expect(looksLikeRawSource("Dear reader,\nSubject: nothing")).toBe(false);
    const html = preparePaste({ source: "<p>Buy <a href='https://shop.example/x'>now</a></p>", subject: "Sale", from: "Shop <deals@shop.example>", date: "2026-11-09" });
    expect("error" in html).toBe(false);
    if ("error" in html) return;
    expect(html.htmlBody).toContain("<p>Buy");
    expect(html.textBody).toBe("Buy now");
    expect(html.fromAddress).toBe("deals@shop.example");
    expect(html.landingUrl).toBe("https://shop.example/x");
    expect(Buffer.from(html.raw).toString("utf8")).toContain("Subject: Sale");
    expect(preparePaste({ source: "Just text", subject: "", from: "", date: "" })).toEqual({ error: expect.stringContaining("sender") });
  });
});

describe("sender matching", () => {
  const competitors = [
    { id: "broad", senderAddresses: [], senderDomains: ["northwind.example"], websites: [] },
    { id: "specific", senderAddresses: [], senderDomains: ["mail.northwind.example"], websites: [] },
    { id: "exact", senderAddresses: ["Editor@Harbor.example"], senderDomains: [], websites: [] },
    { id: "site", senderAddresses: [], senderDomains: [], websites: ["https://www.pinecrest.example/about"] },
  ];

  it("prefers the exact address, then the most specific domain, then a website", () => {
    expect(matchCompetitor("editor@harbor.example", competitors)).toEqual({ competitorId: "exact", matchedBy: "address" });
    expect(matchCompetitor("ana@mail.northwind.example", competitors)).toEqual({ competitorId: "specific", matchedBy: "domain" });
    expect(matchCompetitor("ana@news.northwind.example", competitors)).toEqual({ competitorId: "broad", matchedBy: "domain" });
    expect(matchCompetitor("hi@send.pinecrest.example", competitors)).toEqual({ competitorId: "site", matchedBy: "website" });
    expect(matchCompetitor("someone@notnorthwind.example", competitors)).toBeNull();
    expect(matchCompetitor("garbage", competitors)).toBeNull();
  });

  it("normalizes competitor form input", () => {
    expect(normalizeDomain("https://WWW.Example.com/path?x")).toBe("example.com");
    expect(normalizeDomain("@mail.example.com")).toBe("mail.example.com");
    expect(normalizeDomain("not a domain")).toBe("");
    const clean = normalizeCompetitorInput({
      name: "  Northwind  ",
      products: "Daily Brief, Pro Club\nDaily Brief",
      websites: "northwind.example\nhttps://shop.northwind.example",
      senders: "Editor@Northwind.example, @mail.northwind.example\nnorthwind.example; nonsense",
      notes: "",
      tags: "Big, Health",
    });
    expect(clean).toEqual({
      name: "Northwind",
      products: ["Daily Brief", "Pro Club"],
      websites: ["https://northwind.example", "https://shop.northwind.example"],
      senderAddresses: ["editor@northwind.example"],
      senderDomains: ["mail.northwind.example", "northwind.example"],
      notes: null,
      tags: ["big", "health"],
    });
  });
});

describe("links", () => {
  it("unwraps trackers, counts repeats and skips utility links when guessing the landing page", () => {
    expect(unwrapTrackingUrl("https://t.example/c?u=https%3A%2F%2Fa.example%2Fb")).toBe("https://a.example/b");
    const links = extractLinks(
      `<a href="https://x.example/unsubscribe">Unsubscribe</a><a href="https://facebook.com/x">f</a>
       <a href="https://offer.example/p?s=1">Read</a><a href="https://other.example/">Other</a><a href="https://offer.example/p?s=1"><img alt="Order"></a>`,
      "Also see https://text.example/page.",
    );
    expect(links.map((link) => [link.href, link.count])).toEqual([
      ["https://x.example/unsubscribe", 1],
      ["https://facebook.com/x", 1],
      ["https://offer.example/p?s=1", 2],
      ["https://other.example/", 1],
      ["https://text.example/page", 1],
    ]);
    expect(guessLandingUrl(links)).toBe("https://offer.example/p?s=1");
    expect(guessLandingUrl(links.slice(0, 2))).toBeNull();
  });
});

function extraction(overrides: Partial<EmailExtraction> = {}): EmailExtraction {
  return {
    type: "promo",
    summary: "Sells a course.",
    headline: "The habit",
    bigIdea: null,
    hook: null,
    product: null,
    offer: null,
    priceText: null,
    discount: null,
    guarantee: null,
    experts: [],
    cta: null,
    urgency: { level: "none", tactics: [], deadline: null },
    landingUrl: null,
    angles: [],
    topics: [],
    takeaway: null,
    ...overrides,
  };
}

describe("extraction clean-up", () => {
  const links = [
    { href: "https://offer.example/a", text: "Buy", count: 2 },
    { href: "https://blog.example/b", text: "Read", count: 1 },
  ];
  it("maps the chosen link number, clamps enums and dedupes lists", () => {
    const result = normalizeExtraction(
      {
        ...extraction(),
        type: "bogus" as never,
        experts: ["Ana", "ana", " "],
        angles: ["Fear Of Missing Out", "fear of missing out", "new discovery"],
        urgency: { level: "extreme" as never, tactics: ["Deadline"], deadline: "Friday" },
        landingLink: 2,
      },
      links,
      "https://fallback.example",
    );
    expect(result.type).toBe("other");
    expect(result.experts).toEqual(["Ana"]);
    expect(result.angles).toEqual(["fear of missing out", "new discovery"]);
    expect(result.urgency).toEqual({ level: "none", tactics: ["deadline"], deadline: "Friday" });
    expect(result.landingUrl).toBe("https://blog.example/b");
  });

  it("ignores an out-of-range link and only falls back for commercial sends", () => {
    expect(normalizeExtraction({ ...extraction(), landingLink: 9 }, links, "https://fallback.example").landingUrl).toBe("https://fallback.example");
    expect(normalizeExtraction({ ...extraction({ type: "editorial" }), landingLink: null }, links, "https://fallback.example").landingUrl).toBeNull();
  });

  it("writes a Brain note that labels the price as stated", () => {
    const note = emailBrainNote({
      competitorName: "Northwind",
      fromAddress: "a@northwind.example",
      subject: "Last call",
      receivedAt: new Date("2026-11-10T00:00:00Z"),
      extraction: extraction({ priceText: "$49 a year", landingUrl: "https://www.offer.example/x" }),
    });
    expect(note.title).toBe("Competitor promo: Northwind: Last call");
    expect(note.body).toContain("Price (as stated in the email):** $49 a year");
    expect(note.body).toContain("Landing page:** offer.example");
  });
});

describe("Promo Radar grouping", () => {
  const monday = weekStartOf(new Date("2026-11-12T10:00:00Z"));
  const email = (id: string, day: string, competitor: string | null, ext: EmailExtraction | null, from = "x@unknown.example"): RadarEmail => ({
    id,
    competitorId: competitor,
    competitorName: competitor ? competitor.toUpperCase() : null,
    fromAddress: from,
    subject: `Subject ${id}`,
    receivedAt: new Date(`${day}T12:00:00Z`),
    extraction: ext,
  });

  it("finds the Monday of the week", () => {
    expect(monday.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartOf(new Date("2026-11-15T23:59:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartOf(new Date("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("groups by competitor, merges re-sends of one promo, flags new promos and recurring angles", () => {
    const habit = (angles: string[]) => extraction({ landingUrl: "https://offer.example/habit/?x=1", angles, experts: ["Ana"], priceText: "$49" });
    const earlier = new Set([promoKey({ extraction: extraction({ product: "Old Club" }), subject: "", competitorKey: "c:b" })]);
    const summary = buildRadar({
      weekStart: monday,
      earlierPromoKeys: earlier,
      emails: [
        email("1", "2026-11-09", "a", habit(["fear of missing out"])),
        email("2", "2026-11-11", "a", habit(["fear of missing out", "new discovery"])),
        email("3", "2026-11-10", "a", extraction({ type: "editorial", angles: ["ignored"] })),
        email("4", "2026-11-10", "b", extraction({ product: "Old Club", angles: ["fear of missing out"] })),
        email("5", "2026-11-12", null, null, "promo@stranger.example"),
        email("6", "2026-11-16", "a", habit([])),
        email("7", "2026-11-08", "a", habit([])),
      ],
    });
    expect(summary.weekStart).toBe("2026-11-09");
    expect(summary.weekEnd).toBe("2026-11-15");
    expect(summary.totals).toEqual({ emails: 5, classified: 4, promos: 2, newPromos: 1, competitors: 3 });
    expect(summary.competitors.map((group) => group.name)).toEqual(["A", "B", "Unmatched: stranger.example"]);
    const a = summary.competitors[0]!;
    expect(a.emails).toBe(3);
    expect(a.types).toEqual({ promo: 2, editorial: 1 });
    expect(a.promos).toHaveLength(1);
    expect(a.promos[0]).toMatchObject({ sends: 2, emailIds: ["1", "2"], isNew: true, firstSent: "2026-11-09", angles: ["fear of missing out", "new discovery"] });
    expect(summary.competitors[1]!.promos[0]!.isNew).toBe(false);
    expect(summary.competitors[2]!.types).toEqual({ unclassified: 1 });
    expect(summary.angles).toEqual([{ angle: "fear of missing out", count: 3, competitors: ["A", "B"] }]);

    const note = radarBrainNote({ brandName: "Daily", summary, narrative: { overview: "Busy week.", themes: [], watch: ["Test a deadline."] } });
    expect(note.title).toBe("Promo Radar: week of 2026-11-09");
    expect(note.body).toContain("## A");
    expect(note.body).toContain("Busy week.");
    expect(note.body).toContain("- Test a deadline.");
  });

  it("keys promos by landing page, then product, then headline", () => {
    expect(promoKey({ extraction: extraction({ landingUrl: "https://WWW.offer.example/Habit/" }), subject: "s", competitorKey: "c:a" })).toBe("url:offer.example/habit");
    expect(promoKey({ extraction: extraction({ product: "Pro Club!" }), subject: "s", competitorKey: "c:a" })).toBe("product:c:a:pro club");
    expect(promoKey({ extraction: extraction({ headline: null }), subject: "Big News", competitorKey: "c:a" })).toBe("headline:c:a:big news");
  });
});

describe("Gmail", () => {
  const secret = "local-dev-secret-at-least-16-chars";

  it("builds a read-only offline consent URL", () => {
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://app.example.com/api/intel/gmail/callback", state: "s" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/intel/gmail/callback");
  });

  it("signs state, rejects tampering and expiry", () => {
    const now = Date.UTC(2026, 10, 17);
    const token = signState({ organizationId: "o", brandId: "b", userId: "u", orgSlug: "gazette", returnTo: "/intel/gmail" }, secret, now);
    expect(verifyState(token, secret, now + 1000)).toMatchObject({ organizationId: "o", brandId: "b", userId: "u", orgSlug: "gazette" });
    expect(verifyState(token, "another-secret-that-is-long", now)).toBeNull();
    expect(verifyState(token, secret, now + 16 * 60 * 1000)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), organizationId: "evil" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, secret, now)).toBeNull();
  });

  it("encrypts tokens so the stored value is not the token", () => {
    const sealed = encryptToken("1//refresh-token", secret);
    expect(sealed).not.toContain("refresh");
    expect(decryptToken(sealed, secret)).toBe("1//refresh-token");
    expect(() => decryptToken(sealed, "wrong-secret-wrong-secret")).toThrow();
  });

  function fixtureFetch(routes: Record<string, { status?: number; body: unknown }>): { fetch: FetchLike; calls: string[] } {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
      const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
      const route = key ? routes[key]! : { status: 404, body: { error: { message: "Not found" } } };
      const status = route.status ?? 200;
      return { ok: status < 400, status, json: async () => route.body, text: async () => JSON.stringify(route.body) };
    };
    return { fetch, calls };
  }

  it("uses history for incremental syncs and lists on the first run or when history expired", async () => {
    const history = fixtureFetch({
      "/history": { body: { historyId: "200", history: [{ messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }, { message: { id: "d1", labelIds: ["DRAFT"] } }] }] } },
    });
    expect(await planSync(gmailClient(history.fetch, "t"), { historyId: "100", query: null, lastSyncAt: new Date(), max: 50 })).toEqual({ ids: ["m1"], historyId: "200", mode: "history" });

    const expired = fixtureFetch({
      "/history": { status: 404, body: { error: { message: "Requested entity was not found." } } },
      "/profile": { body: { emailAddress: "w@x.example", historyId: "900" } },
      "/messages?": { body: { messages: [{ id: "a" }, { id: "b" }] } },
    });
    const plan = await planSync(gmailClient(expired.fetch, "t"), { historyId: "100", query: "label:competitors", lastSyncAt: null, max: 50 });
    expect(plan).toEqual({ ids: ["a", "b"], historyId: "900", mode: "initial" });
    expect(new URL(expired.calls.at(-1)!).searchParams.get("q")).toBe("label:competitors newer_than:30d -in:sent -in:drafts");
    // With a filter, history is skipped (it cannot search).
    expect(expired.calls.some((call) => call.includes("/history"))).toBe(false);

    // No filter, but Gmail no longer has the stored history: list since the last run.
    const since = await planSync(gmailClient(expired.fetch, "t"), { historyId: "100", query: null, lastSyncAt: new Date("2026-11-17T00:00:00Z"), max: 50 });
    expect(since.mode).toBe("since");
    expect(new URL(expired.calls.at(-1)!).searchParams.get("q")).toBe(`after:${Date.UTC(2026, 10, 17) / 1000 - 3600} -in:sent -in:drafts`);
  });

  it("fetches raw messages and maps labels to placement", async () => {
    const raw = Buffer.from("From: a@b.example\r\nSubject: Hi\r\n\r\nHello").toString("base64url");
    const { fetch } = fixtureFetch({ "/messages/m1": { body: { id: "m1", raw, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], internalDate: "1789000000000" } } });
    const message = await gmailClient(fetch, "t").rawMessage("m1");
    expect(parseEml(message.raw).subject).toBe("Hi");
    expect(message.internalDate?.getTime()).toBe(1789000000000);
    expect(placementFromLabels(message.labelIds)).toBe("PROMOTIONS");
    expect(placementFromLabels(["INBOX"])).toBe("PRIMARY");
  });
});
