import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDirection } from "../../../../../modules/promo-studio/packager";
import { componentDocx, packageZip } from "./export-docx";

const components = [
  { kind: "space-ads", label: "Space ads", quantity: 2, status: "APPROVED", content: "### Space ad 1: Curiosity\n\n**Headline:** The quiet shift\n\n**Body:** Read why.\n\n### Space ad 2\n\n**Headline:** Second one" },
  { kind: "order-form", label: "Order form", quantity: 1, status: "DRAFT", content: "" },
];

describe("package Word and zip exports", () => {
  it("writes one Word file for a single component", async () => {
    const buffer = await componentDocx({ promoTitle: "Gold Rush", brandName: "Example Daily", packageTitle: "Launch", component: components[0]! });
    const xml = strFromU8(unzipSync(new Uint8Array(buffer))["word/document.xml"]!);
    for (const text of ["Space ads", "Gold Rush", "Example Daily", "Approved", "The quiet shift", "Second one"]) expect(xml).toContain(text);
  });

  it("zips one Word file per component plus the combined file and Markdown", async () => {
    const zip = await packageZip({ title: "Launch package", promoTitle: "Gold Rush", brandName: "Example Daily", status: "DRAFT", direction: parseDirection({ angle: "Contrarian" }), components });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["01 Space ads.docx", "02 Order form.docx", "Launch package (all components).docx", "Launch package.md"]);
    const order = strFromU8(unzipSync(files["02 Order form.docx"]!)["word/document.xml"]!);
    expect(order).toContain("Not written yet.");
    const all = strFromU8(unzipSync(files["Launch package (all components).docx"]!)["word/document.xml"]!);
    expect(all).toContain("Contrarian");
    expect(strFromU8(files["Launch package.md"]!)).toContain("## Space ads");
  });
});
