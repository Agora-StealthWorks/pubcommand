import { describe, expect, it } from "vitest";
import { asPubFilter, filterEditors, filterPublications, initials, isCurrent, priceSummary, safeHref, wikiSearch, type WikiEditor, type WikiPublication } from "./wiki";

const pub = (over: Partial<WikiPublication>): WikiPublication => ({
  id: over.code ?? "x",
  code: "X",
  slug: "x",
  name: "X",
  tagline: null,
  description: null,
  pubType: null,
  tier: null,
  frequency: null,
  status: "active",
  archived: false,
  offers: [],
  editors: [],
  ...over,
});

const pubs = [
  pub({ code: "TDE", name: "The Daily Edge", tagline: "One trade idea every morning", editors: [{ name: "Ada Lee" }] }),
  pub({ code: "INC", name: "Income Report", status: "paused", editors: [{ name: "Raj Patel" }] }),
  pub({ code: "OLD", name: "Old Letter", status: "retired" }),
  pub({ code: "ARC", name: "Archived Letter", archived: true }),
];

describe("wiki publication list", () => {
  it("shows current publications by default and never archived ones", () => {
    expect(filterPublications(pubs, {}).map((p) => p.code)).toEqual(["TDE", "INC"]);
    expect(filterPublications(pubs, { status: "retired" }).map((p) => p.code)).toEqual(["OLD"]);
    expect(filterPublications(pubs, { status: "all" }).map((p) => p.code)).toEqual(["TDE", "INC", "OLD"]);
    expect(isCurrent({ status: "launching", archived: false })).toBe(true);
    expect(asPubFilter("bogus")).toBe("active");
  });

  it("searches name, code, tagline and editors; every word must match", () => {
    expect(filterPublications(pubs, { q: "ada" }).map((p) => p.code)).toEqual(["TDE"]);
    expect(filterPublications(pubs, { q: "inc" }).map((p) => p.code)).toEqual(["INC"]);
    expect(filterPublications(pubs, { q: "trade morning" }).map((p) => p.code)).toEqual(["TDE"]);
    expect(filterPublications(pubs, { q: "trade income" })).toEqual([]);
  });

  it("summarizes price points as typed and counts the rest", () => {
    expect(priceSummary([{ label: "Annual", price: "$49", term: "per year" }, { label: "Lifetime", price: "$499", term: "" }, { label: "VIP", price: "", term: "" }])).toBe("$49 per year · $499 · +1 more");
    expect(priceSummary([])).toBe("");
  });
});

describe("wiki editors and search", () => {
  const editors: WikiEditor[] = [
    { id: "1", slug: "ada-lee", name: "Ada Lee", title: "Chief strategist", shortBio: null, specialties: ["options", "income"], status: "active", publications: [{ name: "The Daily Edge", code: "TDE" }] },
    { id: "2", slug: "raj", name: "Raj Patel", title: null, shortBio: "Dividend hunter", specialties: [], status: "active", publications: [] },
  ];
  it("finds editors by specialty, bio or publication", () => {
    expect(filterEditors(editors, "options").map((e) => e.id)).toEqual(["1"]);
    expect(filterEditors(editors, "dividend").map((e) => e.id)).toEqual(["2"]);
    expect(filterEditors(editors, "tde").map((e) => e.id)).toEqual(["1"]);
  });
  it("home search returns nothing for an empty query and both lists otherwise", () => {
    expect(wikiSearch(pubs, editors, " ")).toEqual({ publications: [], editors: [] });
    const found = wikiSearch(pubs, editors, "edge");
    expect(found.publications.map((p) => p.code)).toEqual(["TDE"]);
    expect(found.editors.map((e) => e.id)).toEqual(["1"]);
  });
  it("makes initials and only links http(s)", () => {
    expect(initials("Ada  Mae Lee")).toBe("AL");
    expect(initials("")).toBe("?");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com")).toBe("https://example.com");
  });
});
