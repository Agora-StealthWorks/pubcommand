import { describe, expect, it } from "vitest";
import { bookmarkletCode, isNonce, parseCapturePayload } from "./capture";
import { CONDENSE_SCHEMA, condensePrompt, condenseTarget, planCondense, relinkPlan, type CondenseInputCard } from "./condense";
import { fallbackReaders, jinaUrl, looksLikeShell, pickBest, proseScore, readerTitle, waybackSnapshot } from "./readers";
import { parsePostUrl, postFromSyndication, postSourceText, postTitle, syndicationUrl, threadPosts } from "./x";

function strict(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object") {
    const props = Object.keys((obj.properties as object) ?? {});
    if (obj.additionalProperties !== false || props.some((p) => !((obj.required as string[]) ?? []).includes(p))) return false;
  }
  return Object.values(obj).every((value) => (Array.isArray(value) ? value.every(strict) : strict(value)));
}

const prose = "The committee said it would review every application before the end of the year, according to the published minutes. ".repeat(10);

describe("X posts and threads", () => {
  it("recognizes post links on every X domain", () => {
    expect(parsePostUrl("https://twitter.com/SomeOne/status/1790000000000000001?s=20")).toEqual({ id: "1790000000000000001", handle: "SomeOne", canonical: "https://x.com/SomeOne/status/1790000000000000001" });
    expect(parsePostUrl("https://mobile.twitter.com/a_b/statuses/123456789")?.id).toBe("123456789");
    expect(parsePostUrl("https://x.com/home")).toBeNull();
    expect(parsePostUrl("https://evilx.com/a/status/123456")).toBeNull();
    expect(syndicationUrl("1790000000000000001")).toMatch(/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=1790000000000000001&lang=en&token=/);
  });

  it("reads a post with its long-form text and walks the author's own thread", () => {
    const raw = {
      id_str: "3",
      text: "short",
      note_tweet: { note_tweet_results: { result: { text: "Third part, the full long text." } } },
      user: { name: "Ann", screen_name: "ann" },
      created_at: "2026-11-01T10:00:00.000Z",
      parent: { id_str: "2", text: "Second part.", user: { name: "Ann", screen_name: "Ann" }, parent: { id_str: "1", text: "First part.", user: { name: "Ann", screen_name: "ann" }, parent: { id_str: "0", text: "Someone else's post", user: { name: "Bob", screen_name: "bob" } } } },
    };
    const post = postFromSyndication(raw)!;
    expect(post.text).toBe("Third part, the full long text.");
    const thread = threadPosts(post);
    expect(thread.map((p) => p.id)).toEqual(["1", "2", "3"]);
    const text = postSourceText(thread);
    expect(text).toContain("Author: Ann (@ann)");
    expect(text).toContain("Thread of 3 posts");
    expect(text.indexOf("[1/3] First part.")).toBeLessThan(text.indexOf("[3/3] Third part"));
    expect(postTitle(post, 3)).toBe("Ann (@ann) on X (thread, 3 posts)");
    expect(postFromSyndication({ id_str: "1", text: "" })).toBeNull();
    expect(postFromSyndication(null)).toBeNull();
  });
});

describe("bookmarklet and capture page", () => {
  it("accepts only a capture message for this tab, with enough text and a safe URL", () => {
    const ok = parseCapturePayload({ __pcCapture: 1, nonce: "abc123def", title: "  A  title ", url: "https://news.example.com/story", text: prose }, "abc123def");
    expect(ok).toMatchObject({ ok: true, payload: { title: "A title", url: "https://news.example.com/story" } });
    expect(parseCapturePayload({ __pcCapture: 1, nonce: "other", text: prose }, "abc123def")).toEqual({ ok: false, reason: "wrong tab" });
    expect(parseCapturePayload({ nonce: "abc123def", text: prose }, "abc123def")).toMatchObject({ ok: false });
    expect(parseCapturePayload({ __pcCapture: 1, nonce: "abc123def", text: "short" }, "abc123def")).toEqual({ ok: false, reason: "too little text" });
    const js = parseCapturePayload({ __pcCapture: 1, nonce: "abc123def", url: "javascript:alert(1)", text: prose }, "abc123def");
    expect(js.ok && js.payload.url).toBeNull();
    expect(parseCapturePayload({ __pcCapture: 1, nonce: "", text: prose }, "")).toMatchObject({ ok: false });
    expect(parseCapturePayload("not an object", "abc123def")).toMatchObject({ ok: false });
  });

  it("builds a bookmarklet that only talks to this workspace's origin", () => {
    const code = bookmarkletCode("https://acme.pubcommand.com/research/abc");
    expect(code.startsWith("javascript:")).toBe(true);
    expect(code).toContain('"https://acme.pubcommand.com"');
    expect(code).toContain("/research/capture#");
    expect(code).not.toContain("/research/abc");
    expect(isNonce("abc123def")).toBe(true);
    expect(isNonce("<img>")).toBe(false);
  });
});

describe("fallback readers", () => {
  it("are off unless the env flag turns them on", () => {
    expect(fallbackReaders({})).toEqual([]);
    expect(fallbackReaders({ RESEARCH_FALLBACK_READERS: "off" })).toEqual([]);
    expect(fallbackReaders({ RESEARCH_FALLBACK_READERS: "all" })).toEqual(["jina", "wayback"]);
    expect(fallbackReaders({ RESEARCH_FALLBACK_READERS: "wayback, nonsense" })).toEqual(["wayback"]);
    expect(fallbackReaders({ RESEARCH_FALLBACK_READERS: "wayback,jina" })).toEqual(["jina", "wayback"]);
  });

  it("scores prose so a bot wall or a menu never counts as the article", () => {
    expect(looksLikeShell("Access Denied. You don't have permission.")).toBe(true);
    expect(proseScore("Home | Markets | News | Sign in | AAPL 1.2% | MSFT 0.4%")).toBe(0);
    expect(proseScore(prose)).toBeGreaterThan(700);
  });

  it("picks the reader with the most prose, earlier readers winning ties", () => {
    const best = pickBest([
      { via: "direct", text: "Please enable JavaScript to continue. " + prose, title: null },
      { via: "jina", text: prose, title: "Story" },
      { via: "wayback", text: prose, title: "Archived" },
    ]);
    expect(best?.via).toBe("jina");
    expect(pickBest([{ via: "direct", text: "Menu | Login", title: null }])).toBeNull();
  });

  it("only follows archive.org snapshots and reads the reader's title line", () => {
    expect(waybackSnapshot({ archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/2026/https://site.example/a" } } })).toBe("https://web.archive.org/web/2026/https://site.example/a");
    expect(waybackSnapshot({ archived_snapshots: { closest: { available: true, url: "http://169.254.169.254/latest" } } })).toBeNull();
    expect(waybackSnapshot({})).toBeNull();
    expect(readerTitle("Title: The Story\nURL Source: x")).toBe("The Story");
    expect(jinaUrl("https://site.example/a?b=1")).toBe("https://r.jina.ai/https://site.example/a?b=1");
  });
});

describe("condense", () => {
  const card = (n: number, over: Partial<CondenseInputCard> = {}): CondenseInputCard => ({
    id: `c${n}`,
    topic: `Topic ${n}`,
    summary: `Summary ${n}`,
    details: "",
    cardType: "fact",
    keyPoints: [{ text: `Fact ${n} is 4.2%`, kind: "stat", location: "p. 1" }],
    tags: ["t"],
    sourceLabel: "Report",
    sourceUrl: "https://example.com/r",
    groupName: "Rates",
    ...over,
  });
  const cards = [card(1), card(2), card(3), card(4)];

  it("merges cards, keeps only key points copied from the originals, and records where each came from", () => {
    const plan = planCondense(cards, {
      cards: [
        { topic: "Merged A", summary: "One.", details: "", cardType: "stat", tags: ["x"], from: [1, 2, 2, 9], keyPoints: [{ text: "fact 1 is 4.2%", kind: "stat", location: "" }, { text: "Invented 99%", kind: "stat", location: "" }] },
        { topic: "Merged B", summary: "Two.", details: "", cardType: "fact", tags: [], from: [2, 3, 4], keyPoints: [{ text: "Fact 4 is 4.2%", kind: "stat", location: "" }] },
      ],
    });
    expect(plan.problem).toBeNull();
    expect(plan.cards.map((c) => c.fromIds)).toEqual([
      ["c1", "c2"],
      ["c3", "c4"],
    ]);
    expect(plan.cards[0]!.keyPoints).toEqual([{ text: "Fact 1 is 4.2%", kind: "stat", location: "p. 1" }]);
    expect(plan.cards[1]!.keyPoints.map((p) => p.text)).toEqual(["Fact 4 is 4.2%"]);
    expect(plan.cards[0]).toMatchObject({ sourceUrl: "https://example.com/r", groupName: "Rates" });
  });

  it("refuses an answer that is not shorter or not usable", () => {
    expect(planCondense(cards, { cards: [] }).problem).toMatch(/usable/);
    const same = { cards: cards.map((c, i) => ({ topic: c.topic, summary: "s", details: "", cardType: "fact", tags: [], from: [i + 1], keyPoints: [] })) };
    expect(planCondense(cards, same).problem).toMatch(/shorter/);
  });

  it("moves outline links onto the card that absorbed them, once per bullet", () => {
    const links = relinkPlan(
      [
        { newId: "n1", fromIds: ["c1", "c2"] },
        { newId: "n2", fromIds: ["c3"] },
      ],
      [
        { bulletId: "b1", cardId: "c2", position: 1 },
        { bulletId: "b1", cardId: "c1", position: 0 },
        { bulletId: "b2", cardId: "c3", position: 0 },
        { bulletId: "b2", cardId: "zz", position: 1 },
      ],
    );
    expect(links).toEqual([
      { bulletId: "b1", cardId: "n1", position: 0 },
      { bulletId: "b2", cardId: "n2", position: 0 },
    ]);
  });

  it("aims for about half and builds a strict schema and prompt", () => {
    expect(condenseTarget(10)).toBe(5);
    expect(condenseTarget(3)).toBe(2);
    expect(condenseTarget(10, 20)).toBe(9);
    expect(strict(CONDENSE_SCHEMA)).toBe(true);
    expect(condensePrompt({ brandContext: "Brand", projectName: "P", cards, target: 2 })).toContain("4. Topic 4");
  });
});
