import { describe, expect, it } from "vitest";
import { canEdit, canManage, canView, isPublicToken, projectAccess } from "./access";
import { exportBlocks, exportFilename, outlineMarkdown, type ExportProject } from "./export";
import { applyGrouping, brainNote, describeFailure, extractionPrompt, extractionProblem, normalizeExtraction, TRUNCATED_MESSAGE } from "./extract";
import {
  checkFetchUrl,
  deriveTitle,
  htmlTitle,
  htmlToText,
  isBlockedAddress,
  normalizeText,
  parseCaptionTracks,
  pickCaptionTrack,
  timedTextToTranscript,
  youtubeVideoId,
} from "./ingest";
import { attachCard, detachCard, moveCard, moveStep, moveTo, nextPosition, outlineFromGroups, positionChanges, sortByPosition, usageCounts } from "./outline";

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::5",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("accepts ordinary article links", () => {
    const result = checkFetchUrl("https://www.example.com/news/story?id=4");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["ftp://example.com/file", "http"],
    ["file:///etc/passwd", "http"],
    ["http://localhost/", "private"],
    ["http://app.localhost/", "private"],
    ["http://db.railway.internal/", "private"],
    ["http://printer.local/", "private"],
    ["http://intranet/", "private"],
    ["http://127.0.0.1/", "private"],
    ["http://[::1]/", "private"],
    ["http://169.254.169.254/latest/meta-data", "private"],
    ["http://2130706433/", "address"],
    ["http://0x7f000001/", "address"],
    ["http://user:pass@example.com/", "password"],
    ["https://example.com:6379/", "port"],
    ["not a url", "valid"],
  ])("refuses %s", (url, reason) => {
    const result = checkFetchUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.toLowerCase()).toContain(reason);
  });
});

describe("ingest normalization", () => {
  it("collapses whitespace but keeps paragraphs and caps length", () => {
    expect(normalizeText("  One\t\ttwo \r\n\r\n\r\n\r\nThree\u0000  ")).toBe("One two\n\nThree");
    expect(normalizeText("abcdef", 3)).toBe("abc");
  });

  it("prefers the article body and drops scripts, nav and entities", () => {
    const filler = "Real reporting sentence. ".repeat(40);
    const html = `<html><head><title>Ignored &amp; title</title><script>var x = "<p>bad</p>";</script></head>
      <body><nav>Home | About | Subscribe</nav><article><h1>The Story</h1><p>${filler}</p><p>Second &quot;para&quot; &#8212; done</p></article>
      <footer>Copyright</footer></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("The Story");
    expect(text).toContain('Second "para" — done');
    expect(text).not.toContain("Subscribe");
    expect(text).not.toContain("bad");
    expect(text).not.toContain("Copyright");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the whole page when there is no article", () => {
    expect(htmlToText("<body><p>Short page</p><ul><li>One</li><li>Two</li></ul></body>")).toBe("Short page\n\n- One\n\n- Two");
  });

  it("reads the og:title before the <title>", () => {
    expect(htmlTitle('<meta property="og:title" content="Real headline"><title>Site | x</title>')).toBe("Real headline");
    expect(htmlTitle("<title> A &amp; B </title>")).toBe("A & B");
    expect(htmlTitle("<p>none</p>")).toBeNull();
  });

  it("derives a title from what it has", () => {
    expect(deriveTitle({ title: " Mine ", fallback: "x" })).toBe("Mine");
    expect(deriveTitle({ url: "https://www.example.org/a", fallback: "x" })).toBe("example.org");
    expect(deriveTitle({ text: "\n\nFirst line here\nsecond", fallback: "x" })).toBe("First line here");
    expect(deriveTitle({ text: "y".repeat(120), fallback: "x" })).toHaveLength(78);
    expect(deriveTitle({ fallback: "Pasted research" })).toBe("Pasted research");
  });

  it("finds YouTube video ids in every link shape", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}&t=10s`,
      `https://youtu.be/${id}?si=abc`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(youtubeVideoId(url)).toBe(id);
    }
    expect(youtubeVideoId("https://vimeo.com/12345")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("parses caption tracks and prefers human English", () => {
    const html = `var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=es","name":{"simpleText":"Spanish"},"languageCode":"es"},
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en&kind=asr","name":{"simpleText":"English (auto) [x]"},"languageCode":"en","kind":"asr"},
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","name":{"runs":[{"text":"English"}]},"languageCode":"en"}
    ],"audioTracks":[]}}};`;
    const tracks = parseCaptionTracks(html);
    expect(tracks).toHaveLength(3);
    expect(pickCaptionTrack(tracks)?.baseUrl).toBe("https://www.youtube.com/api/timedtext?v=1&lang=en");
    expect(pickCaptionTrack(tracks.slice(0, 2))?.kind).toBe("asr");
    expect(parseCaptionTracks("<html>no captions</html>")).toEqual([]);
    expect(pickCaptionTrack([])).toBeNull();
  });

  it("turns timed text into a stamped transcript", () => {
    const xml = `<?xml version="1.0"?><transcript>
      <text start="0.5" dur="2">Welcome &amp;amp; hello</text>
      <text start="12" dur="2">we start</text>
      <text start="45.2" dur="3">the big &#39;number&#39;</text>
      <text start="3725" dur="3">late</text></transcript>`;
    expect(timedTextToTranscript(xml)).toBe("[0:00] Welcome & hello we start\n\n[0:45] the big 'number'\n\n[1:02:05] late");
    expect(timedTextToTranscript('<timedtext><body><p t="61000" d="1000">srv3 format</p></body></timedtext>')).toBe("[1:01] srv3 format");
  });
});

describe("card extraction clean-up", () => {
  it("drops empty cards, dedupes topics, clamps fields and fixes enums", () => {
    const result = normalizeExtraction({
      sourceTitle: " Report ",
      sourceSummary: "About things.",
      cards: [
        { topic: "A finding", summary: "It matters.", details: "", cardType: "stat", keyPoints: [{ text: "42% said yes", kind: "stat", location: "p. 3" }, { text: "", kind: "fact", location: "" }], tags: ["#Energy", "energy", " Grid  Power "] },
        { topic: "a finding", summary: "Duplicate", details: "", cardType: "fact", keyPoints: [], tags: [] },
        { topic: "", summary: "no topic", details: "", cardType: "fact", keyPoints: [], tags: [] },
        { topic: "Odd type", summary: "Still kept", details: "x", cardType: "rumor", keyPoints: [{ text: "q", kind: "gossip", location: "" }], tags: "nope" },
      ],
    });
    expect(result.sourceTitle).toBe("Report");
    expect(result.cards.map((card) => card.topic)).toEqual(["A finding", "Odd type"]);
    expect(result.cards[0]!.keyPoints).toEqual([{ text: "42% said yes", kind: "stat", location: "p. 3" }]);
    expect(result.cards[0]!.tags).toEqual(["energy", "grid power"]);
    expect(result.cards[1]!.cardType).toBe("other");
    expect(result.cards[1]!.keyPoints[0]!.kind).toBe("fact");
    expect(result.cards[1]!.tags).toEqual([]);
  });

  it("caps the number of cards at 15", () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ topic: `Card ${i}`, summary: "s", details: "", cardType: "fact", keyPoints: [], tags: [] }));
    expect(normalizeExtraction({ cards }).cards).toHaveLength(15);
  });

  it("reports an empty answer and a truncated run clearly", () => {
    expect(extractionProblem(normalizeExtraction({ cards: [] }))).toMatch(/did not find/);
    expect(extractionProblem(normalizeExtraction(null))).not.toBeNull();
    expect(describeFailure("The analysis ran out of room before it finished. Try again.")).toBe(TRUNCATED_MESSAGE);
    expect(describeFailure("The AI is busy")).toBe("The AI is busy");
  });

  it("puts the brand context and source in the prompt", () => {
    const prompt = extractionPrompt({ brandContext: "Brand: Example (Health)", projectName: "Sleep", projectBrief: "", sourceTitle: "Study", sourceKind: "url", text: "Body text" });
    expect(prompt).toContain("Brand: Example (Health)");
    expect(prompt).toContain("<source>\nBody text\n</source>");
    expect(prompt).not.toContain("\n\n\n");
    expect(extractionPrompt({ brandContext: "B", projectName: "P", projectBrief: "", sourceTitle: "S", sourceKind: "file", text: null })).toContain("attached PDF");
  });

  it("maps AI groups back to card ids, first pile wins", () => {
    const groups = applyGrouping(["a", "b", "c"], { groups: [{ name: "Costs", cards: [1, 2, 9] }, { name: "People", cards: [2, 3] }, { name: "", cards: [3] }] });
    expect(Object.fromEntries(groups)).toEqual({ a: "Costs", b: "Costs", c: "People" });
    expect(applyGrouping(["a"], null).size).toBe(0);
  });

  it("builds a Brain note grouped by pile", () => {
    const note = brainNote({
      projectName: "Grid",
      description: "",
      brandName: "Example",
      sources: [{ title: "Article", sourceRef: "https://example.com/a" }, { title: "Upload", sourceRef: "file.pdf" }],
      cards: [{ topic: "T", summary: "S", groupName: "Costs", keyPoints: [{ text: "42%", kind: "stat", location: "p. 2" }], sourceLabel: "Article" }],
    });
    expect(note.title).toBe("Research: Grid");
    expect(note.body).toContain("## Costs");
    expect(note.body).toContain("- **T**: S (Article)");
    expect(note.body).toContain("  - 42% [p. 2]");
    expect(note.body).toContain("- Article: https://example.com/a");
    expect(note.body).toContain("- Upload\n".trim());
  });
});

describe("outline operations", () => {
  it("sorts by position with a stable tie-break", () => {
    expect(sortByPosition([{ id: "b", position: 1 }, { id: "c", position: 0 }, { id: "a", position: 1 }]).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ id: "a", position: 4 }, { id: "b", position: 2 }])).toBe(5);
  });

  it("moves up and down and stops at the ends", () => {
    expect(moveStep(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveStep(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveStep(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveStep(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveStep(["a"], "zz", "up")).toEqual(["a"]);
  });

  it("moves to an index, clamping and inserting", () => {
    expect(moveTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b"], "z", 1)).toEqual(["a", "z", "b"]);
    expect(moveTo(["a", "b"], "z", -5)).toEqual(["z", "a", "b"]);
  });

  it("writes only the positions that change", () => {
    const current = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
    expect(positionChanges(current, ["a", "c", "b"])).toEqual([{ id: "c", position: 1 }, { id: "b", position: 2 }]);
    expect(positionChanges(current, ["a", "b", "c"])).toEqual([]);
    expect(positionChanges(current, ["x", "a"])).toEqual([{ id: "a", position: 1 }]);
  });

  it("attaches, detaches and moves cards between bullets", () => {
    let placement = attachCard({}, "b1", "c1");
    placement = attachCard(placement, "b1", "c2");
    placement = attachCard(placement, "b1", "c1"); // already there: moves to the end, no duplicate
    expect(placement.b1).toEqual(["c2", "c1"]);
    placement = attachCard(placement, "b1", "c3", 0);
    expect(placement.b1).toEqual(["c3", "c2", "c1"]);
    placement = moveCard(placement, { cardId: "c2", from: "b1", to: "b2" });
    expect(placement).toEqual({ b1: ["c3", "c1"], b2: ["c2"] });
    placement = moveCard(placement, { cardId: "c1", from: "b1", to: "b1", index: 0 });
    expect(placement.b1).toEqual(["c1", "c3"]);
    placement = detachCard(placement, "b1", "c3");
    expect(placement.b1).toEqual(["c1"]);
    expect(detachCard(placement, "nope", "c1")).toBe(placement);
    placement = attachCard(placement, "b2", "c1");
    expect(usageCounts(placement).get("c1")).toBe(2);
  });

  it("builds a starter outline from topic groups with ungrouped last", () => {
    const outline = outlineFromGroups([
      { id: "1", topic: "Loose", groupName: null },
      { id: "2", topic: "Cost A", groupName: "Costs" },
      { id: "3", topic: "Cost B", groupName: "Costs" },
    ]);
    expect(outline.map((section) => section.title)).toEqual(["Costs", "Ungrouped"]);
    expect(outline[0]!.bullets).toEqual([{ text: "Cost A", cardIds: ["2"] }, { text: "Cost B", cardIds: ["3"] }]);
  });
});

describe("project access", () => {
  const base = { ownerId: "u1", viewerId: "u2", viewerEmail: "Ada@Example.com", isAdmin: false, canWrite: true, shares: [] as { email: string; permission: string }[] };

  it("is private to the owner by default", () => {
    expect(projectAccess({ ...base, viewerId: "u1" })).toBe("owner");
    expect(projectAccess(base)).toBe("none");
    expect(canView("none")).toBe(false);
  });

  it("lets admins see and manage everything", () => {
    const access = projectAccess({ ...base, isAdmin: true });
    expect(access).toBe("admin");
    expect(canManage(access)).toBe(true);
  });

  it("matches shares by email, case-insensitively", () => {
    expect(projectAccess({ ...base, shares: [{ email: "ada@example.com", permission: "view" }] })).toBe("view");
    const edit = projectAccess({ ...base, shares: [{ email: "ADA@example.com", permission: "edit" }] });
    expect(edit).toBe("edit");
    expect(canEdit(edit)).toBe(true);
    expect(canManage(edit)).toBe(false);
  });

  it("is read-only without research.write", () => {
    expect(projectAccess({ ...base, viewerId: "u1", canWrite: false })).toBe("view");
    expect(projectAccess({ ...base, canWrite: false, shares: [{ email: "ada@example.com", permission: "edit" }] })).toBe("view");
  });

  it("checks public token shape", () => {
    expect(isPublicToken("a".repeat(32))).toBe(true);
    expect(isPublicToken("a".repeat(31))).toBe(false);
    expect(isPublicToken("../../etc/passwd/aaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("outline export", () => {
  const project: ExportProject = {
    name: "Grid *Power*",
    description: "Why the grid is short of power.",
    brandName: "Example Daily",
    sections: [
      { title: "The problem", bullets: [{ text: "Demand is rising", cardIds: ["c1", "missing"] }, { text: "", cardIds: [] }] },
      { title: "", bullets: [] },
    ],
    cards: [
      { id: "c1", topic: "Data centers", summary: "They use a lot.", keyPoints: [{ text: "4.4% of US power", kind: "stat", location: "p. 12" }], sourceLabel: "Report", sourceUrl: "https://example.com/report (1)" },
      { id: "c2", topic: "Unused", summary: "Not placed.", keyPoints: [], sourceLabel: "", sourceUrl: null },
    ],
  };

  it("renders numbered sections, bullets, cards, points and sources", () => {
    const md = outlineMarkdown(project);
    expect(md).toBe(
      [
        "# Grid \\*Power\\*",
        "",
        "_Example Daily · Research outline_",
        "",
        "Why the grid is short of power.",
        "",
        "## 1. The problem",
        "",
        "- Demand is rising",
        "  - **Data centers**: They use a lot.",
        "    - 4.4% of US power _(p. 12)_",
        "    - Source: [Report](https://example.com/report%20%281%29)",
        "- (empty bullet)",
        "",
        "## 2. Untitled section",
        "",
      ].join("\n"),
    );
  });

  it("can append cards that are not in the outline", () => {
    const md = outlineMarkdown({ ...project, includeUnplaced: true });
    expect(md).toContain("## Research not yet in the outline");
    expect(md).toContain("**Unused**: Not placed.");
    expect(md.match(/Data centers/g)).toHaveLength(1);
  });

  it("gives the same blocks to every format", () => {
    const blocks = exportBlocks(project);
    expect(blocks.filter((block) => block.type === "card")).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "title", text: "Grid *Power*" });
  });

  it("makes safe file names", () => {
    expect(exportFilename("Grid: *Power*/2026", "md")).toBe("Grid Power2026 - outline.md");
    expect(exportFilename("???", "docx")).toBe("research - outline.docx");
  });
});
