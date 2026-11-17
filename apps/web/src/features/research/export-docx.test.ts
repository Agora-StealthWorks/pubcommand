import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { outlineDocx } from "./export-docx";

describe("outline Word export", () => {
  it("writes sections, bullets, cards, points and a source link", async () => {
    const buffer = await outlineDocx({
      name: "Grid power",
      description: "Why the grid is short.",
      brandName: "Example Daily",
      sections: [{ title: "The problem", bullets: [{ text: "Demand is rising", cardIds: ["c1"] }] }],
      cards: [{ id: "c1", topic: "Data centers", summary: "They use a lot.", keyPoints: [{ text: "4.4% of US power", kind: "stat", location: "p. 12" }], sourceLabel: "Report", sourceUrl: "https://example.com/report" }],
    });
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const files = unzipSync(new Uint8Array(buffer));
    const xml = strFromU8(files["word/document.xml"]!);
    for (const text of ["Grid power", "Example Daily · Research outline", "1. The problem", "Demand is rising", "Data centers: ", "They use a lot.", "4.4% of US power", "(p. 12)", "Report"]) {
      expect(xml).toContain(text);
    }
    expect(strFromU8(files["word/_rels/document.xml.rels"]!)).toContain("https://example.com/report");
  });
});
