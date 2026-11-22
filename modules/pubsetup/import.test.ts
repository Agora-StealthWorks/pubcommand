import { describe, expect, it } from "vitest";
import { IMPORT_FORMAT, fillBlanks, parseImport, placeLogos, planImport } from "./import";
import { PUBLICATION_FIELDS } from "./fields";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function file(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: IMPORT_FORMAT,
    publications: [
      { code: "edge", name: "The Daily Edge", tagline: "Short and sharp", deliverables: ["Daily issue", "Alerts"], offers: [{ label: "Annual", price: "$49", term: "per year" }], logo: PNG, editors: [{ editor: "Ann Lee", role: "lead" }, { editor: "Bo Ray", role: "nonsense" }, "Nobody"] },
      { code: "EDGE", name: "Duplicate" },
      { code: "x y", name: "Bad code" },
    ],
    editors: [
      { name: "Ann Lee", title: "Chief Strategist", specialties: ["Options"], photo: PNG },
      { name: "Bo Ray", photo: "data:text/html;base64,PGI+" },
    ],
    ...extra,
  });
}

describe("parseImport", () => {
  it("rejects files that are not import files", () => {
    expect(parseImport("nope").ok).toBe(false);
    expect(parseImport(JSON.stringify({ publications: [] })).ok).toBe(false);
  });

  it("validates records like the form and keeps the good ones", () => {
    const result = parseImport(file());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { publications, editors, links, warnings } = result.file;
    expect(publications.map((p) => p.values.code)).toEqual(["EDGE"]);
    expect(publications[0]!.values.slug).toBe("the-daily-edge");
    expect(publications[0]!.values.deliverables).toEqual(["Daily issue", "Alerts"]);
    expect(publications[0]!.values.offers).toEqual([{ label: "Annual", price: "$49", term: "per year" }]);
    expect(publications[0]!.logos.auto?.mime).toBe("image/png");
    expect(editors.map((e) => e.values.slug)).toEqual(["ann-lee", "bo-ray"]);
    expect(editors[1]!.photo).toBeNull();
    expect(links).toEqual([
      { code: "EDGE", editorSlug: "ann-lee", role: "lead" },
      { code: "EDGE", editorSlug: "bo-ray", role: "lead" },
    ]);
    expect(warnings.join("\n")).toMatch(/appears twice/);
    expect(warnings.join("\n")).toMatch(/Bad code skipped/);
    expect(warnings.join("\n")).toMatch(/"Nobody" is not in the file/);
    expect(warnings.join("\n")).toMatch(/Bo Ray: the photo/);
  });
});

describe("planImport", () => {
  it("creates new records and only fills blanks on existing ones", () => {
    const parsed = parseImport(file());
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = planImport(parsed.file, {
      publications: [{ id: "p1", code: "EDGE", slug: "edge", name: "Edge (typed by an admin)", tagline: "Admin tagline", deliverables: [], status: "paused", color: "#000000", hasLogoLight: true, hasLogoDark: false }],
      editors: [{ id: "e1", slug: "ann", name: "ann lee", title: null, specialties: ["Typed"], hasPhoto: false }],
      links: [{ code: "EDGE", editorSlug: "ann" }],
      brandLogos: { light: false, dark: false },
    });
    const pub = plan.publications[0]!;
    expect(pub.action).toBe("fill");
    expect(pub.fill).toEqual({ deliverables: ["Daily issue", "Alerts"], offers: [{ label: "Annual", price: "$49", term: "per year" }] });
    // The file's unsorted logo counts as the light-background one, which the publication already has.
    expect(pub.image).toBe(false);
    const [ann, bo] = plan.editors;
    expect(ann!.action).toBe("fill");
    expect(ann!.existingId).toBe("e1");
    expect(ann!.fill).toEqual({ title: "Chief Strategist" });
    expect(ann!.image).toBe(true);
    expect(bo!.action).toBe("create");
    // Ann matched an existing editor by name, so her link is already there under that editor's slug.
    expect(plan.links.map((l) => l.action)).toEqual(["same", "create"]);
    expect(plan.counts).toEqual({ create: 1, fill: 2, same: 0, links: 1 });
    expect(plan.brandLogo).toBe(false);
  });

  it("never fills required or layout fields", () => {
    const fill = fillBlanks(PUBLICATION_FIELDS, { name: "", code: "", status: "", color: "", sortOrder: 0, slug: null }, { name: "X", code: "X", status: "active", color: "#ffffff", sortOrder: 3, slug: "x", tagline: "T" });
    expect(fill).toEqual({ tagline: "T" });
  });
});

describe("pricing and logo slots in the import", () => {
  const DARK = "data:image/png;base64,ZGFyaw==";
  const LIGHT = "data:image/png;base64,bGlnaHQ=";
  const text = JSON.stringify({
    format: IMPORT_FORMAT,
    brand: { logoDark: LIGHT },
    publications: [
      { code: "PRO", name: "Pro Letter", retailPrice: "$7,500/yr", lifetimePrice: "$25,000 one-time", salePrice: "$4,995", pricingNotes: "Renews at list.", logoLight: DARK, logoDark: LIGHT },
      { code: "AUTO", name: "Auto Letter", logo: LIGHT, pubType: "Text letter (SMS)", tier: "Bonus / complimentary" },
      { code: "BAD", name: "Bad Logo", logoDark: "data:text/html;base64,PGI+" },
    ],
  });

  it("accepts the pricing keys, the new options and the logoLight / logoDark keys", () => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const [pro, auto, bad] = parsed.file.publications;
    expect(pro!.values).toMatchObject({ retailPrice: "$7,500/yr", lifetimePrice: "$25,000 one-time", salePrice: "$4,995", pricingNotes: "Renews at list." });
    expect(pro!.logos.light?.filename).toBe("pro-on-light.png");
    expect(pro!.logos.dark?.filename).toBe("pro-on-dark.png");
    expect(auto!.values).toMatchObject({ tier: "Bonus / complimentary" });
    // The legacy type is kept (internal funnel rule) and names the category when none is given.
    expect(auto!.pubType).toBe("Text letter (SMS)");
    expect(auto!.category).toBe("Text letter (SMS)");
    expect(auto!.logos.auto).not.toBeNull();
    expect(bad!.logos).toEqual({ auto: null, light: null, dark: null });
    expect(parsed.file.warnings.join("\n")).toMatch(/Bad Logo: the logo for dark backgrounds is not/);
    expect(parsed.file.brandLogos.dark).not.toBeNull();
  });

  it("files an auto-sorted logo by its tone and fills only empty slots", () => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const auto = parsed.file.publications[1]!;
    const sorted = { ...auto, logos: placeLogos(auto.logos, "dark") };
    expect(sorted.logos.dark).toBe(auto.logos.auto);
    expect(sorted.logos.light).toBeNull();
    const file = { ...parsed.file, publications: [parsed.file.publications[0]!, sorted] };
    const plan = planImport(file, {
      publications: [{ id: "p1", code: "PRO", slug: "pro", name: "Pro", retailPrice: "Typed by an admin", hasLogoLight: true, hasLogoDark: false }],
      editors: [],
      links: [],
      brandLogos: { light: false, dark: true },
    });
    const [pro, created] = plan.publications;
    expect(pro!.fill).toMatchObject({ lifetimePrice: "$25,000 one-time", salePrice: "$4,995" });
    expect(pro!.fill.retailPrice).toBeUndefined();
    expect(pro!.logoSlots).toEqual({ light: false, dark: true });
    expect(pro!.label).toContain("logo for dark backgrounds");
    expect(created!.logoSlots).toEqual({ light: false, dark: true });
    expect(plan.brandLogo).toBe(false);
  });

  it("keeps a named slot over an auto-sorted logo", () => {
    const img = { mime: "image/png", data: new Uint8Array([1]), filename: "a.png" };
    const named = { mime: "image/png", data: new Uint8Array([2]), filename: "b.png" };
    expect(placeLogos({ auto: img, light: null, dark: named }, "dark")).toEqual({ auto: null, light: null, dark: named });
    expect(placeLogos({ auto: img, light: named, dark: null }, null)).toEqual({ auto: null, light: named, dark: img });
  });
});

describe("replace", () => {
  it("replaces only the listed fields, including clearing them", () => {
    const text = JSON.stringify({ format: IMPORT_FORMAT, replace: ["offers", "name", "bogus"], publications: [{ code: "EDGE", name: "New name", tagline: "T" }] });
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.file.replace).toEqual(["offers"]);
    const plan = planImport(parsed.file, {
      publications: [{ id: "p1", code: "EDGE", slug: "edge", name: "Old", tagline: "Kept", offers: [{ label: "List price", price: "$1", term: "" }], hasLogoLight: false, hasLogoDark: false }],
      editors: [],
      links: [],
      brandLogos: { light: false, dark: false },
    });
    expect(plan.publications[0]!.fill).toEqual({ offers: [] });
    expect(plan.publications[0]!.label).toBe("replaces price points and offers");
  });
});

describe("categories in the import", () => {
  const text = JSON.stringify({
    format: IMPORT_FORMAT,
    publications: [
      { code: "A", name: "Alpha", category: "  Trading   services " },
      { code: "B", name: "Bravo", category: "trading services" },
      { code: "C", name: "Charlie", category: "Free newsletters" },
      { code: "D", name: "Delta", category: "x".repeat(70) },
      { code: "E", name: "Echo", pubType: "Free newsletter", category: "Research" },
      { code: "F", name: "Foxtrot", pubType: "Hedge fund" },
    ],
  });

  it("reads category by name, tidies it and warns on bad ones", () => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const byCode = Object.fromEntries(parsed.file.publications.map((p) => [String(p.values.code), p]));
    expect(byCode.A!.category).toBe("Trading services");
    expect(byCode.D!.category).toBeNull();
    expect(byCode.E).toMatchObject({ category: "Research", pubType: "Free newsletter" });
    expect(byCode.F).toMatchObject({ category: null, pubType: null });
    expect(parsed.file.warnings.join("\n")).toMatch(/Delta: the category/);
    expect(parsed.file.warnings.join("\n")).toMatch(/Foxtrot: type "Hedge fund"/);
  });

  it("creates missing categories once (any case) and only fills an empty category", () => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = planImport(parsed.file, {
      publications: [
        { id: "pa", code: "A", slug: "a", name: "Alpha", status: "active", color: "#000000", hasLogoLight: false, hasLogoDark: false, categoryId: "free" },
        { id: "pb", code: "B", slug: "b", name: "Bravo", status: "active", color: "#000000", hasLogoLight: false, hasLogoDark: false, categoryId: null },
      ],
      editors: [],
      links: [],
      brandLogos: { light: false, dark: false },
      categories: [{ id: "free", name: "FREE NEWSLETTERS" }],
    });
    expect(plan.categories).toEqual(["Trading services", "Research"]);
    const step = (code: string) => plan.publications.find((p) => p.record.values.code === code)!;
    expect(step("A").category).toBeNull(); // already has one: fill-only
    expect(step("B")).toMatchObject({ action: "fill", category: "trading services" });
    expect(step("B").label).toContain("category");
    expect(step("C")).toMatchObject({ action: "create", category: "Free newsletters" });
  });

  it("moves a publication to the file's category when the file replaces category", () => {
    const parsed = parseImport(JSON.stringify({ format: IMPORT_FORMAT, replace: ["category"], publications: [{ code: "A", name: "Alpha", category: "Research" }] }));
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = planImport(parsed.file, {
      publications: [{ id: "pa", code: "A", slug: "a", name: "Alpha", status: "active", color: "#7f77dd", hasLogoLight: false, hasLogoDark: false, categoryId: "free" }],
      editors: [],
      links: [],
      brandLogos: { light: false, dark: false },
      categories: [{ id: "free", name: "Free newsletters" }],
    });
    expect(plan.publications[0]).toMatchObject({ action: "fill", category: "Research" });
    expect(plan.publications[0]!.label).toContain("moves it to Research");
  });
});
