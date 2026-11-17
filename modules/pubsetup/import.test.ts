import { describe, expect, it } from "vitest";
import { IMPORT_FORMAT, fillBlanks, parseImport, planImport } from "./import";
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
    expect(publications[0]!.logo?.mime).toBe("image/png");
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
      publications: [{ id: "p1", code: "EDGE", slug: "edge", name: "Edge (typed by an admin)", tagline: "Admin tagline", deliverables: [], status: "paused", color: "#000000", hasLogo: true }],
      editors: [{ id: "e1", slug: "ann", name: "ann lee", title: null, specialties: ["Typed"], hasPhoto: false }],
      links: [{ code: "EDGE", editorSlug: "ann" }],
      brandHasLogo: false,
    });
    const pub = plan.publications[0]!;
    expect(pub.action).toBe("fill");
    expect(pub.fill).toEqual({ deliverables: ["Daily issue", "Alerts"], offers: [{ label: "Annual", price: "$49", term: "per year" }] });
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
