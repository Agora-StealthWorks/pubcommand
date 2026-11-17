import { describe, expect, it } from "vitest";
import {
  COMPONENT_SCHEMA,
  PACKAGE_COMPONENTS,
  checkClaims,
  clampQuantity,
  componentMarkdown,
  componentPrompt,
  componentSpec,
  itemCount,
  markdownBlocks,
  packageBrainNote,
  packageMarkdown,
  packagerSystem,
  parseDirection,
  preview,
  rankNotes,
  type PromoContext,
} from "./packager";

function schemaIsStrict(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object") {
    const props = Object.keys((obj.properties as object) ?? {});
    if (obj.additionalProperties !== false) return false;
    const required = (obj.required as string[]) ?? [];
    if (props.some((p) => !required.includes(p))) return false;
  }
  return Object.values(obj).every((value) => (Array.isArray(value) ? value.every(schemaIsStrict) : schemaIsStrict(value)));
}

const promo: PromoContext = {
  title: "The Morning Edge",
  product: "Edge Letter",
  publisher: "Gazette",
  gurus: ["Jane Roe"],
  sourceText: "Join 12,000 readers. Only $49 a year, a 75% saving. Backed by our 365-day money-back guarantee.",
  analysis: {
    summary: "Sells a newsletter.",
    bigIdea: "Read less, know more.",
    headline: "The Edge",
    offer: { product: "Edge Letter", price: "$49", term: "1 year", bonuses: ["Bonus report"], guarantee: "365 days", urgency: "Price rises Friday", summary: "s" },
    strengths: ["Clear promise"],
    lessons: [],
    compliance: [{ quote: "You will never lose", rule: "No guarantees" }],
  },
};

describe("component registry", () => {
  it("has unique kinds, sane quantities, and the old app's components", () => {
    const kinds = PACKAGE_COMPONENTS.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const c of PACKAGE_COMPONENTS) {
      expect(c.minQty).toBeLessThanOrEqual(c.defaultQty);
      expect(c.defaultQty).toBeLessThanOrEqual(c.maxQty);
      expect(c.fields.length).toBeGreaterThan(0);
    }
    for (const kind of ["alternative-headlines", "vsl-lift-notes", "space-ads", "cart-abandon-emails", "exit-popup", "order-form", "editorial-guide"]) {
      expect(componentSpec(kind)).toBeDefined();
    }
    expect(PACKAGE_COMPONENTS.filter((c) => c.event).length).toBe(5);
  });

  it("clamps quantities", () => {
    const spec = componentSpec("space-ads")!;
    expect(clampQuantity(spec, "99")).toBe(20);
    expect(clampQuantity(spec, 0)).toBe(1);
    expect(clampQuantity(spec, "abc")).toBe(10);
    expect(clampQuantity(componentSpec("exit-popup")!, 4)).toBe(1);
  });

  it("schema is strict for structured output", () => {
    expect(schemaIsStrict(COMPONENT_SCHEMA)).toBe(true);
  });
});

describe("direction", () => {
  it("parses defensively", () => {
    expect(parseDirection(null)).toEqual({ angle: "", tone: "", length: "standard", offerDetails: "", notes: "", event: null });
    const d = parseDirection({ angle: " fear ", length: "longer", event: { name: "Summit", date: "May 3" } });
    expect(d.angle).toBe("fear");
    expect(d.length).toBe("longer");
    expect(d.event).toEqual({ name: "Summit", date: "May 3" });
    expect(parseDirection({ length: "huge", event: { name: "" } })).toMatchObject({ length: "standard", event: null });
  });
});

describe("prompts", () => {
  it("system prompt carries the niche rules and base claims rules", () => {
    const health = packagerSystem("health");
    expect(health).toContain("health and wellness");
    expect(health).toContain("compliance rule");
    expect(health).toContain("Never invent numbers");
    expect(health).toContain("loser lists");
    const general = packagerSystem("general");
    expect(general).not.toMatch(/stock|ticker|invest/i);
  });

  it("user prompt includes promo, direction, context and revision", () => {
    const text = componentPrompt({
      brandContext: "Brand: Gazette (General)\nReader: Busy parents",
      promo,
      direction: parseDirection({ angle: "Time saved", offerDetails: "Launch price $39", event: { name: "Live Q&A", date: "" } }),
      spec: componentSpec("space-ads")!,
      quantity: 4,
      bestPerformers: [{ title: "Old winner", headline: "H", bigIdea: "B", lessons: ["L"], excerpt: "E" }],
      brainNotes: [{ title: "Voice", body: "Short sentences." }],
      previous: { content: "### Space ad 1", feedback: "Punchier" },
    });
    expect(text).toContain("Reader: Busy parents");
    expect(text).toContain("Angle: Time saved");
    expect(text).toContain("Launch price $39");
    expect(text).toContain("Live Q&A (date [DATE])");
    expect(text).toContain("Old winner");
    expect(text).toContain("Short sentences.");
    expect(text).toContain("Space ads (4 items)");
    expect(text).toContain("Feedback: Punchier");
    expect(text).toContain("<promo>");
    expect(text).toContain('"You will never lose" (No guarantees)');
  });

  it("asks for the attached PDF when there is no text", () => {
    const text = componentPrompt({
      brandContext: "Brand: Gazette",
      promo: { ...promo, sourceText: "", analysis: null },
      direction: parseDirection({}),
      spec: componentSpec("exit-popup")!,
      quantity: 1,
      bestPerformers: [],
      brainNotes: [],
    });
    expect(text).toContain("attached PDF");
    expect(text).toContain("(1 item)");
    expect(text).not.toContain("<analysis>");
  });
});

describe("rendering", () => {
  const spec = componentSpec("space-ads")!;
  const md = componentMarkdown(spec, {
    items: [
      { title: "Curiosity", fields: [{ label: "Headline", text: "The one habit" }, { label: "Body", text: "Line one.\n\n\n\nLine two." }, { label: "Empty", text: " " }] },
      { title: "", fields: [{ label: "Headline", text: "Second" }] },
    ],
    notes: "Check the price.",
  });

  it("renders items as headed Markdown", () => {
    expect(md).toContain("### Space ad 1: Curiosity");
    expect(md).toContain("**Headline:** The one habit");
    expect(md).toContain("**Body:**\n\nLine one.\n\nLine two.");
    expect(md).not.toContain("Empty");
    expect(md).toContain("### Space ad 2");
    expect(md).toContain("> Note: Check the price.");
    expect(itemCount(md)).toBe(2);
  });

  it("reads Markdown back into blocks", () => {
    const blocks = markdownBlocks("# T\n\n### Item\n**Headline:** Hi\nmore\n\n- a\n> note");
    expect(blocks.map((b) => b.type)).toEqual(["h1", "h3", "p", "bullet", "quote"]);
    expect(blocks[2]!.runs).toEqual([
      { text: "Headline:", bold: true },
      { text: " Hi\nmore", bold: false },
    ]);
  });

  it("previews plain text", () => {
    expect(preview(md, 30)).toBe("Headline: The one habit Body:…");
  });

  it("builds the package Markdown and Brain note", () => {
    const components = [
      { kind: "alternative-headlines", label: "Alternative headlines", quantity: 2, status: "APPROVED", content: "### Headline 1\n\n**Headline:** Read less\n\n### Headline 2\n\n**Headline:** Know more" },
      { kind: "exit-popup", label: "Exit popup", quantity: 1, status: "DRAFT", content: "" },
    ];
    const doc = packageMarkdown({ title: "Launch", promoTitle: "Edge", brandName: "Gazette", status: "DRAFT", direction: parseDirection({ tone: "warm" }), components });
    expect(doc).toContain("# Launch");
    expect(doc).toContain("- Tone: warm");
    expect(doc).toContain("- Exit popup (1) · Draft");
    expect(doc).toContain("_Not written yet._");
    const note = packageBrainNote({ title: "Launch", promoTitle: "Edge", brandName: "Gazette", direction: parseDirection({}), components });
    expect(note.title).toBe("Copy package: Edge");
    expect(note.body).toContain("- Read less");
    expect(note.body).toContain('**Alternative headlines** (2): e.g. "Headline 1"');
  });
});

describe("claims check", () => {
  const allowed = promo.sourceText;

  it("flags guaranteed results in every niche", () => {
    for (const niche of ["finance", "health", "general"] as const) {
      const flags = checkClaims("This is guaranteed to work. You can't lose.", { niche, allowedText: "" });
      expect(flags.filter((f) => f.severity === "risk").length).toBe(2);
    }
  });

  it("uses the niche's own rules", () => {
    const text = "It cures arthritis and treats heart disease. Double your money with our losers list.";
    const health = checkClaims(text, { niche: "health", allowedText: "" }).map((f) => f.phrase);
    expect(health).toContain("cures");
    expect(health).toContain("treats heart disease");
    expect(health).not.toContain("Double your money");
    const finance = checkClaims(text, { niche: "finance", allowedText: "" }).map((f) => f.phrase);
    expect(finance).toContain("Double your money");
    expect(finance).toContain("losers list");
    expect(finance).not.toContain("cures");
    expect(checkClaims(text, { niche: "general", allowedText: "" })).toEqual([]);
  });

  it("flags figures that are not in the source", () => {
    const flags = checkClaims("Only $49 for a 75% saving. Past picks rose 312%. Join 12,000 readers.", { niche: "general", allowedText: allowed });
    expect(flags.map((f) => f.phrase)).toEqual(["312%"]);
    expect(flags[0]!.severity).toBe("check");
    expect(flags[0]!.excerpt).toContain("rose 312%");
  });

  it("does not flag the offer's money-back guarantee as a result claim", () => {
    expect(checkClaims("Backed by our 365-day money-back guarantee.", { niche: "finance", allowedText: allowed })).toEqual([]);
  });

  it("bans phrases quoted in the brand's own rules", () => {
    const flags = checkClaims("A gentle detox for busy people.", { niche: "general", allowedText: "", rules: ['Never say "detox" or "cleanse".', "Be kind."] });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ phrase: "detox", severity: "risk" });
    expect(flags[0]!.rule).toContain("Never say");
  });

  it("puts risks before checks and dedupes", () => {
    const flags = checkClaims("Risk-free! Try it. You can't lose. You can't lose.", { niche: "general", allowedText: "" });
    expect(flags.map((f) => f.severity)).toEqual(["risk", "check"]);
  });
});

describe("rankNotes", () => {
  it("prefers notes that share words with the query", () => {
    const notes = [
      { title: "Office party", body: "Cake on Friday." },
      { title: "Lift note lessons", body: "Short subject lines with curiosity win for lift notes." },
      { title: "Order form layout", body: "Stack the bonuses." },
    ];
    expect(rankNotes(notes, "lift notes subject curiosity", 2).map((n) => n.title)).toEqual(["Lift note lessons"]);
    expect(rankNotes(notes, "", 2)).toHaveLength(2);
  });
});
