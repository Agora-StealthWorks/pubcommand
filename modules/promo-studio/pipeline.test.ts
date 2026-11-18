import { describe, expect, it } from "vitest";
import { locateCub } from "./analysis";
import { SAMPLE_ANSWER, SAMPLE_COPY } from "./fixtures";
import { parseAnalysis, parseCub, parseHeadline, parseIntel, parseOffer, parseOutline, parseSixteenWord, parseTease } from "./parse";
import { ANALYSIS_SYSTEM, analysisContext, directiveBlock, matchDirectory, pickCalibration, reevaluatePrompt, type CalibrationExample } from "./prompt";
import { blend, DIMENSION_WEIGHTS, DIMENSIONS, finalScore, parseScorecard, TOTAL_WEIGHT } from "./score";
import { activeSection, progressPercent, SECTION_KEYS, splitSections } from "./sections";
import { analysisDigest, analysisMarkdown, buildStored, cubQuotes, effectiveScorecard, intelNote, sourceCopyNote } from "./stored";

describe("sections", () => {
  it("cuts a full answer into all eight sections, in order", () => {
    const s = splitSections(SAMPLE_ANSWER, true);
    expect(SECTION_KEYS.every((k) => s[k]?.complete)).toBe(true);
    expect(s.HEADLINE!.text.startsWith("**Eyebrow:**")).toBe(true);
    expect(progressPercent(s)).toBe(100);
    expect(activeSection(s)).toBeNull();
  });

  it("marks the section being written as incomplete while streaming", () => {
    const cut = SAMPLE_ANSWER.indexOf("Q4 —");
    const s = splitSections(SAMPLE_ANSWER.slice(0, cut));
    expect(s.HEADLINE?.complete).toBe(true);
    expect(s.OUTLINE?.complete).toBe(true);
    expect(s.SIXTEEN_WORD).toMatchObject({ complete: false });
    expect(s.SIXTEEN_WORD!.text).toContain("Q3");
    expect(activeSection(s)).toBe("SIXTEEN_WORD");
    expect(progressPercent(s)).toBe(25);
    expect(s.CUB).toBeUndefined();
  });

  it("hides a half-written closing marker and treats an unclosed section followed by another as complete", () => {
    const s = splitSections("<<HEADLINE>>\nHeadline: Hi\n<</HEAD");
    expect(s.HEADLINE).toEqual({ text: "Headline: Hi", complete: false });
    const forgot = splitSections("<<HEADLINE>>\nHeadline: Hi\n<<OUTLINE>>\n1. The Lead — x\n<</OUTLINE>>", true);
    expect(forgot.HEADLINE).toEqual({ text: "Headline: Hi", complete: true });
    expect(forgot.OUTLINE?.complete).toBe(true);
  });

  it("tolerates decorated markers and aliases, and ignores text outside sections", () => {
    const s = splitSections("Sure! Here it is.\n**<< Effectiveness >>**\n1. Hook Strength: 7/10 — ok\n**<</EFFECTIVENESS>>**\nThanks", true);
    expect(s.SCORECARD?.text).toBe("1. Hook Strength: 7/10 — ok");
  });

  it("returns nothing for an answer with no markers", () => {
    expect(splitSections("I cannot help with that.", true)).toEqual({});
  });
});

describe("scorecard", () => {
  it("uses the publisher's weights", () => {
    expect(DIMENSIONS).toHaveLength(8);
    expect(TOTAL_WEIGHT).toBeCloseTo(9.4);
    expect(DIMENSION_WEIGHTS["Hook Strength"]).toBe(1.6);
    expect(DIMENSION_WEIGHTS.Specificity).toBe(0.8);
  });

  it("parses all eight dimensions in bold, en-dash and 'N / 10:' variants, plus the adjustment", () => {
    const card = parseScorecard(splitSections(SAMPLE_ANSWER, true).SCORECARD!.text);
    expect(card.dimensions.map((d) => d.score)).toEqual([8, 6, 7, 7, 7, 8, 6, 8]);
    expect(card.dimensions[2]).toMatchObject({ name: "Specificity", rationale: expect.stringContaining("Scores 7") });
    expect(card.adjustment).toMatchObject({ value: 0.3 });
    expect(card.blended).toBe(7.2);
    expect(card.final).toBe(7.5);
    expect(card.rationale).toMatch(/^I would bet/);
  });

  it("bounds the adjustment to one point and the score to 1-10", () => {
    const card = parseScorecard(DIMENSIONS.map((d) => `${d}: 10/10 — great`).join("\n") + "\nAdjustment: +3 — too good");
    expect(card.adjustment?.value).toBe(1);
    expect(card.final).toBe(10);
    const low = parseScorecard(DIMENSIONS.map((d) => `${d}: 1/10 — bad`).join("\n") + "\nAdjustment: −2 — worse");
    expect(low.adjustment?.value).toBe(-1);
    expect(low.final).toBe(1);
  });

  it("averages the weight it saw when dimensions are missing, and is null with none", () => {
    expect(blend([{ name: "Hook Strength", score: 8 }, { name: "Specificity", score: 4 }])).toBe(Math.round(((8 * 1.6 + 4 * 0.8) / 2.4) * 10) / 10);
    expect(finalScore([])).toBeNull();
    expect(parseScorecard("garbage\nno numbers here").final).toBeNull();
  });

  it("drops doubled separators before a rationale", () => {
    expect(parseScorecard("1. Hook strength – 8 / 10: — Scores 8 because x").dimensions[0]).toMatchObject({ score: 8, rationale: "Scores 8 because x" });
  });

  it("reads loose dimension labels (CTA, credibility)", () => {
    const card = parseScorecard("CTA: 5/10 — fine\nCredibility: 9/10 — strong\nHook: 7 — ok");
    expect(card.dimensions.map((d) => d.name)).toEqual(["Hook Strength", "Believability", "Call to Action / Urgency"]);
  });
});

describe("section parsers", () => {
  const sections = splitSections(SAMPLE_ANSWER, true);
  const text = (k: (typeof SECTION_KEYS)[number]) => sections[k]!.text;

  it("headline: block, 4 U's and verdict", () => {
    const h = parseHeadline(text("HEADLINE"));
    expect(h).toMatchObject({ eyebrow: "", headline: "The 4-Minute Morning Habit", subhead: expect.stringContaining("kitchen spice") });
    expect(h.fourUs[2]!.note.startsWith('"4-minute"')).toBe(true);
    expect(h.fourUs.map((u) => [u.label, u.rating])).toEqual([["Urgent", "weak"], ["Unique", "present"], ["Ultra-specific", "present"], ["Useful", "present"]]);
    expect(h.verdict).toMatch(/^A strong curiosity/);
  });

  it("outline: numbered sections with purposes", () => {
    const o = parseOutline(text("OUTLINE"));
    expect(o).toHaveLength(4);
    expect(o[0]).toEqual({ title: "The Lead", purpose: expect.stringContaining("4-minute") });
    expect(o[1]!.title).toBe("Walt's Grandmother");
  });

  it("16-word: ten questions and eight close steps with canonical labels", () => {
    const s = parseSixteenWord(text("SIXTEEN_WORD"));
    expect(s.items.filter((i) => i.kind === "question")).toHaveLength(10);
    expect(s.items.filter((i) => i.kind === "close")).toHaveLength(8);
    expect(s.items[2]).toMatchObject({ label: "How do I know this is real?", rating: "weak" });
    expect(s.items[3]).toMatchObject({ rating: "missing" });
    expect(s.verdict).toMatch(/^The story/);
  });

  it("CUB: flags parsed, broken JSON gives null, never a throw", () => {
    const cub = parseCub(text("CUB"))!;
    expect(cub.map((c) => c.type)).toEqual(["confusing", "unbelievable", "boring"]);
    expect(parseCub('[{"text": "a", "type": "boring"')).toBeNull();
    expect(parseCub('[{"text": "keep me", "type": "boring", "reason": "r"}, {"text": "cut', )).toEqual([{ text: "keep me", type: "boring", reason: "r" }]);
    expect(parseCub("")).toBeNull();
    expect(parseCub("[]")).toEqual([]);
    expect(parseCub('```json\n[{"quote":"x y z","type":"Boring","why":"w"},{"text":"t","type":"other"}]\n```')).toEqual([{ text: "x y z", type: "boring", reason: "w" }]);
  });

  it("CUB flags highlight in the source copy", () => {
    const spans = locateCub(SAMPLE_COPY, cubQuotes(parseCub(text("CUB"))!));
    expect(spans).toHaveLength(3);
  });

  it("offer: fields, premiums list, inferred publisher label", () => {
    const o = parseOffer(text("OFFER"));
    expect(o).toMatchObject({ product: "Vital Gazette Letter", prices: "$99 a year regular; $39 today", guarantee: expect.stringContaining("90-day"), publisher: "Gazette Health", publisherInferred: true });
    expect(o.premiums).toEqual(["The Morning Ritual Guide", "The Joint Kitchen"]);
    expect(o.bigIdea).toMatch(/^A forgotten kitchen spice/);
  });

  it("tease: generic subject, clues, guesses; NONE means nothing teased", () => {
    const t = parseTease(text("TEASE"));
    expect(t).toMatchObject({ present: true, subject: expect.stringContaining("ingredient"), confidence: "high" });
    expect(t.clues).toHaveLength(2);
    expect(t.guesses[0]).toMatch(/^Turmeric/);
    expect(parseTease("NONE").present).toBe(false);
    expect(parseTease("**NONE**").present).toBe(false);
  });

  it("intel: JSON object parsed; broken JSON gives null", () => {
    const i = parseIntel(text("INTEL"))!;
    expect(i.expert?.name).toBe("Dr. Alan Reyes");
    expect(i.product?.proof).toEqual(["Patient story (LIVE)"]);
    expect(i.topics).toContain("joint health");
    expect(parseIntel('{"expert": {"name": "x"')).toBeNull();
    expect(parseIntel("not json")).toBeNull();
  });

  it("missing sections parse to empty values", () => {
    const p = parseAnalysis({});
    expect(p.headline.headline).toBe("");
    expect(p.outline).toEqual([]);
    expect(p.sixteenWord.items).toEqual([]);
    expect(p.cub).toBeNull();
    expect(p.tease.present).toBe(false);
    expect(p.intel).toBeNull();
    expect(p.scorecard.final).toBeNull();
  });
});

describe("attribution", () => {
  const directory = {
    publications: [{ code: "VGL", name: "Vital Gazette Letter", editors: ["Alan Reyes"] }, { code: "MORNING", name: "Morning Brief", editors: [] }],
    editors: [{ name: "Alan Reyes", title: "MD", publications: ["Vital Gazette Letter"] }, { name: "Bo", title: null, publications: [] }],
  };

  it("finds editors and publications named in the copy, whole words only", () => {
    const m = matchDirectory(SAMPLE_COPY.replace("Alan Reyes", "Alan\n  Reyes"), directory);
    expect(m.map((x) => [x.kind, x.name])).toEqual([["editor", "Alan Reyes"], ["publication", "Vital Gazette Letter"]]);
    expect(matchDirectory("Alan Reyesson wrote it", directory)).toEqual([]);
    // Short names never match; a code counts only in brackets.
    expect(matchDirectory("Bo said join (MORNING) today", directory).map((x) => x.name)).toEqual(["Morning Brief"]);
    expect(matchDirectory("GOOD MORNING", directory).map((x) => x.name)).toEqual([]);
  });

  it("the directive names the brand as publisher; the AI's guess never overrides a code match", () => {
    const matches = matchDirectory(SAMPLE_COPY, directory);
    expect(directiveBlock("Gazette Daily", matches)).toContain("the Publisher is Gazette Daily");
    expect(directiveBlock("Gazette Daily", [])).toBe("");
    const stored = buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches });
    const d = analysisDigest(stored, "Gazette Daily")!;
    expect(d.detected).toMatchObject({ publisher: "Gazette Daily", publisherInferred: false, gurus: ["Alan Reyes"], product: "Vital Gazette Letter", pricePoint: 99, promoType: "Front-end" });
    const unmatched = analysisDigest(buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches: [] }), "Gazette Daily")!;
    expect(unmatched.detected).toMatchObject({ publisher: "Gazette Health", publisherInferred: true, gurus: ["Dr. Alan Reyes"] });
  });
});

describe("prompt", () => {
  it("system prompt is stable, niche-neutral and lists the format", () => {
    for (const key of SECTION_KEYS) expect(ANALYSIS_SYSTEM).toContain(`<<${key}>>`);
    expect(ANALYSIS_SYSTEM).toContain("Why now?");
    expect(ANALYSIS_SYSTEM).toContain("Call to Action / Urgency");
    expect(ANALYSIS_SYSTEM).not.toMatch(/50.?70|retire|stock market/i);
  });

  it("calibration keeps anchors and ranks the rest by relevance", () => {
    const ex = (id: string, extra: Partial<CalibrationExample> = {}): CalibrationExample => ({ id, title: id, gurus: [], publisher: null, product: null, promoType: null, bigIdea: "", predicted: null, performance: null, myScore: null, notes: "", bestPerformer: false, ...extra });
    const picked = pickCalibration(
      [ex("a"), ex("b", { gurus: ["Alan Reyes"] }), ex("c", { performance: 9.5 }), ex("d", { promoType: "Front-end" })],
      { gurus: ["alan reyes"], promoType: "Front-end", topics: [] },
      2,
    );
    expect(picked.anchors.map((e) => e.id)).toEqual(["c"]);
    expect(picked.standard.map((e) => e.id)).toEqual(["b", "d"]);
  });

  it("context carries the brand reader, directive, modality, and run date", () => {
    const ctx = analysisContext({
      brandContext: "Brand: Gazette Daily (Health and wellness)\nReader: Adults 45-75\nCompliance rules:\n- No cure claims.",
      directory: { publications: [{ code: "VGL", name: "Vital Gazette Letter", editors: ["Alan Reyes"] }], editors: [] },
      matches: [{ kind: "publication", name: "Vital Gazette Letter", publications: ["Vital Gazette Letter"], editors: ["Alan Reyes"] }],
      publicationBlock: "",
      editorProfiles: [],
      calibration: [],
      lessons: [{ title: "Name the research", body: "Promos that name the study convert better.", pinned: true }],
      brainNotes: [],
      visual: false,
      title: "Morning Habit",
      runStartDate: "2026-10-01",
      promoCode: "VGL123",
      known: { gurus: [], promoType: null, publisher: null, product: null },
    });
    expect(ctx).toContain("Reader: Adults 45-75");
    expect(ctx).toContain("the Publisher is Gazette Daily");
    expect(ctx).toContain("words only");
    expect(ctx).toContain("Started running around: 2026-10-01");
    expect(ctx).toContain("Name the research");
  });

  it("re-evaluation prompt carries the feedback and the strong-signal flag", () => {
    const p = reevaluatePrompt({ brandContext: "Brand: X", scorecardText: "1. Hook Strength: 5/10 — ok", promoType: "Front-end", performance: 9, myScore: null, notes: "Crushed it", strongSignal: true });
    expect(p).toContain("Real-world performance: 9/10");
    expect(p).toContain("STRONG SIGNAL");
  });
});

describe("stored analysis", () => {
  it("builds a v2 row and digests it for downstream readers", () => {
    const stored = buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches: [] });
    expect(stored).toMatchObject({ format: "sections", version: 2, truncated: false, incomplete: [] });
    expect(stored.scorecard.final).toBe(7.5);
    const d = analysisDigest(stored, "Gazette Daily")!;
    expect(d.version).toBe(2);
    expect(d.final).toBe(7.5);
    expect(d.scores).toHaveLength(8);
    expect(d.scores[0]).toMatchObject({ name: "Hook strength", score: 8 });
    expect(d.headline.headline).toBe("The 4-Minute Morning Habit");
    expect(d.offer.bonuses).toHaveLength(2);
    expect(d.strengths.some((s) => s.startsWith("Hook Strength"))).toBe(true);
    // Missing testimonials (C3) are never listed as a fix.
    expect(d.fixes.some((s) => s.startsWith("Social proof"))).toBe(false);
    expect(d.fixes.some((s) => s.startsWith("Why now?"))).toBe(true);
    expect(d.cubCount).toBe(3);
  });

  it("a cut-off answer keeps finished sections and lists the rest as incomplete", () => {
    const cut = SAMPLE_ANSWER.slice(0, SAMPLE_ANSWER.indexOf("<<TEASE>>") + 30);
    const stored = buildStored({ raw: cut, finished: false, visual: true, matches: [] });
    expect(stored.truncated).toBe(true);
    expect(stored.incomplete).toEqual(["TEASE", "INTEL", "SCORECARD"]);
    expect(stored.scorecard.final).toBeNull();
    expect(analysisDigest(stored)!.final).toBeNull();
  });

  it("an applied re-evaluation replaces the shown scorecard", () => {
    const stored = buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches: [] });
    stored.calibrated = { text: DIMENSIONS.map((d) => `${d}: 9/10 — better`).join("\n") + "\nRationale: It won.", appliedAt: "2026-11-18" };
    const card = effectiveScorecard(stored);
    expect(card).toMatchObject({ calibrated: true, final: 9, rationale: "It won." });
    expect(analysisDigest(stored)!.final).toBe(9);
  });

  it("still reads a v1 JSON analysis, and rejects junk", () => {
    const v1 = {
      summary: "Sells a letter.",
      detected: { publisher: "Acme", gurus: ["Jane"], product: "Letter", pricePoint: 49, promoType: "Front-end" },
      headline: { eyebrow: "", headline: "Old", subhead: "", fourUs: {}, verdict: "", alternatives: [] },
      outline: [],
      sixteenWord: { bigIdea: "Big", questions: [], close: [] },
      cub: [{ quote: "q", type: "boring", why: "w", fix: "f" }],
      offer: { product: "p", price: "$49", term: "1 yr", bonuses: ["b"], guarantee: "g", urgency: "u", summary: "s" },
      tease: { teased: false, subject: "", clues: [], guesses: [] },
      compliance: [],
      scores: [{ name: "Hook strength", score: 8, note: "n" }],
      strengths: ["s"],
      fixes: ["f"],
      lessons: ["l"],
    };
    const d = analysisDigest(v1)!;
    expect(d).toMatchObject({ version: 1, bigIdea: "Big", lessons: ["l"], cubCount: 1 });
    expect(analysisDigest(null)).toBeNull();
    expect(analysisDigest({ random: true })).toBeNull();
  });

  it("Markdown, Brain and facts notes", () => {
    const stored = buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches: [] });
    const md = analysisMarkdown({ title: "Morning Habit", brandName: "Gazette Daily", stored, fk: { ease: 72.1, grade: 6.2 }, meta: { promoCode: "VGL1" } });
    expect(md).toContain("# Promo review: Morning Habit");
    expect(md).toContain("Score: 7.5/10");
    expect(md).toContain("Reading ease: 72.1 (Fairly easy)");
    expect(md).toContain("UNBELIEVABLE");
    expect(md).toContain("Final (weighted): 7.5/10");
    const intel = intelNote({ title: "Morning Habit", intel: parseIntel(splitSections(SAMPLE_ANSWER, true).INTEL!.text), score: 7.5, analyzedAt: new Date("2026-11-18") })!;
    expect(intel.title).toBe("Promo facts: Morning Habit");
    expect(intel.body).toContain("Ran a joint clinic");
    expect(intelNote({ title: "x", intel: null, score: null, analyzedAt: new Date() })).toBeNull();
    expect(sourceCopyNote({ title: "x", text: "  ", meta: [] })).toBeNull();
    expect(sourceCopyNote({ title: "x", text: "copy", meta: ["Code: A"] })!.body).toContain("- Code: A");
    expect(md.toLowerCase()).not.toContain("main brain");
  });
});
