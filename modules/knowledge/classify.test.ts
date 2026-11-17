import { describe, expect, it } from "vitest";
import { classifyNote, compileRules, namesFromSource, publicationsFromTable, type ClassifierRules } from "./classify";

// Fictional publisher: the classifier must work for any brand, not just one.
const rules: ClassifierRules = {
  brandFolders: ["Areas/ACME", "Resources/Editorial Issues"],
  generalFolders: ["Resources/Competitors", "Resources/Industry Tactics", "Resources/Publication Descriptions"],
  brandNames: ["Acme Traders"],
  brandMarks: ["ACT"],
  people: ["Jane Roe"],
  publications: ["The Night Desk"],
  publicationCodes: ["TND", "WAR"],
  brandTags: ["acme-traders", "act"],
};
const compiled = compileRules(rules);
const classify = (path: string, text = "plain note") => classifyNote(path, text, compiled);

describe("vault classifier", () => {
  it("sends brand folders to the brand", () => {
    expect(classify("Areas/ACME/Ops.md")).toMatchObject({ destination: "brand", rule: "brand-folder" });
    expect(classify("Resources/Editorial Issues/TND/2026-01-01.md")).toMatchObject({ destination: "brand", rule: "brand-folder" });
  });

  it("matches brand, editor and publication names in the path, even inside a general folder", () => {
    expect(classify("Resources/Competitors/Acme Traders/index.md")).toMatchObject({ destination: "brand", rule: "brand-name-in-path" });
    expect(classify("Resources/Publication Descriptions/The Night Desk.md")).toMatchObject({ destination: "brand", evidence: ["The Night Desk"] });
    expect(classify("Resources/Knowledge/Jane Roe — Voice.md")).toMatchObject({ destination: "brand" });
    expect(classify("Resources/Publications/THE-NIGHT-DESK-W-JANE-ROE.md").destination).toBe("brand");
    expect(classify("Resources/Promo Analysis/TND Promo Analysis.md")).toMatchObject({ destination: "brand", evidence: ["TND"] });
    expect(classify("Resources/ACT vs Others.md").destination).toBe("brand");
  });

  it("matches publication codes and marks only as whole, upper-case words in the title", () => {
    expect(classify("Resources/Industry Tactics/Warfare headlines.md").destination).toBe("general");
    expect(classify("Resources/Misc/war stories.md").destination).toBe("general");
    expect(classify("Resources/TND/notes about tactics.md").destination).toBe("general");
    expect(classify("Resources/Misc/Acting lessons.md").destination).toBe("general");
  });

  it("sends general folders to the main Brain", () => {
    expect(classify("Resources/Competitors/Other Guru.md", "Jane Roe Jane Roe Jane Roe")).toMatchObject({ destination: "general", rule: "general-folder" });
    expect(classify("Resources/Industry Tactics/16-Word Sales Letter.md")).toMatchObject({ destination: "general" });
  });

  it("uses front-matter tags and brand-heavy bodies outside the known folders", () => {
    expect(classify("Resources/Strategy.md", "---\ntags: [publications/acme-traders/people/x]\n---\nbody")).toMatchObject({ destination: "brand", rule: "brand-tag" });
    expect(classify("Resources/Strategy.md", "---\ntags: [act]\n---\nbody")).toMatchObject({ destination: "brand", rule: "brand-tag" });
    expect(classify("Resources/Q3.md", "Acme Traders plans. Jane Roe leads. The Night Desk grows.")).toMatchObject({ destination: "brand", rule: "brand-body" });
    expect(classify("Resources/Copy.md", "Mentions Acme Traders once.")).toMatchObject({ destination: "general", rule: "default" });
  });

  it("is deterministic", () => {
    const text = "---\ntags: [copy]\n---\nAcme Traders once";
    expect(classify("Resources/A.md", text)).toEqual(classify("Resources/A.md", text));
  });

  it("reads editor names and publication tables from source files", () => {
    expect(namesFromSource("  {\n    name: 'Jane Roe',\n    role: 'x'\n  },\n  { name: \"Rick Poe\" }")).toEqual(["Jane Roe", "Rick Poe"]);
    const table = "| recordedAt | code | name | type |\n| --- | --- | --- | --- |\n| 2026 | TND | The Night Desk | E-Letter |\n| 2026 | TND | The Night Desk | E-Letter |\n| x | bad code | Nope | y |";
    expect(publicationsFromTable(table)).toEqual([{ code: "TND", name: "The Night Desk" }]);
  });
});
