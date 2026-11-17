import { describe, expect, it } from "vitest";
import { linkResolver, linksTo, maskCode, parseWikiLinkBody, parseWikiLinks, titleKey } from "./wikilinks";

describe("wiki links", () => {
  it("parses targets, headings, aliases and embeds", () => {
    expect(parseWikiLinkBody("Jeff Brown#Track record|Jeff")).toEqual({
      raw: "Jeff Brown#Track record|Jeff",
      target: "Jeff Brown",
      heading: "Track record",
      alias: "Jeff",
      embed: false,
    });
    const links = parseWikiLinks("See [[Alpha]] and [[Folder/Beta|the beta]]. ![[chart.png]] [[#Local heading]]");
    expect(links.map((link) => [link.target, link.alias, link.embed, link.heading])).toEqual([
      ["Alpha", null, false, null],
      ["Folder/Beta", "the beta", false, null],
      ["chart.png", null, true, null],
      ["", null, false, "Local heading"],
    ]);
    expect(parseWikiLinkBody("   ")).toBeNull();
  });

  it("ignores links inside code", () => {
    const md = "Real [[One]]\n```\n[[Not a link]]\n```\nInline `[[Nope]]` and [[Two]]";
    expect(parseWikiLinks(md).map((link) => link.target)).toEqual(["One", "Two"]);
    expect(maskCode("a\n~~~\nb\n~~~\nc").split("\n")).toEqual(["a", "   ", " ", "   ", "c"]);
  });

  it("matches titles by last path segment, case and spacing folded", () => {
    expect(titleKey("Resources/Experts/Jeff  Brown.md")).toBe("jeff brown");
    expect(linksTo("Talk to [[resources/jeff brown|him]]", "Jeff Brown")).toBe(true);
    expect(linksTo("![[Jeff Brown]]", "Jeff Brown")).toBe(false);
    expect(linksTo("`[[Jeff Brown]]`", "Jeff Brown")).toBe(false);
  });

  it("prefers the scope's own brand, then the main Brain, for duplicate titles", () => {
    const notes = [
      { id: "other", title: "Style guide", brandId: "b", visibility: "SHARED" as const },
      { id: "main", title: "Style Guide", brandId: null, visibility: "SHARED" as const },
      { id: "own", title: "style guide", brandId: "a", visibility: "PRIVATE" as const },
      { id: "solo", title: "Offers", brandId: "b", visibility: "SHARED" as const },
    ];
    expect(linkResolver(notes, "a")("Style guide")?.id).toBe("own");
    expect(linkResolver(notes, "c")("Style guide")?.id).toBe("main");
    expect(linkResolver(notes, null)("offers")?.id).toBe("solo");
    expect(linkResolver(notes, "a")("Missing")).toBeNull();
  });
});
