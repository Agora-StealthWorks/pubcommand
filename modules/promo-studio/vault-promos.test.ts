import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanPromoTitle, codeFromFileName, isOrderForm, parseVaultPromoPath, pptxText, promoFieldsFromVault } from "./vault-promos";

describe("vault promo library", () => {
  it("reads funnel, publication, tier and format from the path", () => {
    expect(parseVaultPromoPath("Resources/Promos/FE's/TPU/Winning TPU VSLs/TPU Unicorn Promo_LEGAL.docx")).toEqual({ funnel: "FE", code: "TPU", tier: "winning", format: "VSL", group: null });
    expect(parseVaultPromoPath("Resources/Promos/BE's/WAR/Under Performing War Live Webinar/War Live Demo deck.pptx")).toMatchObject({ funnel: "BE", code: "WAR", tier: "under", format: "Live Webinar" });
    expect(parseVaultPromoPath("Resources/Promos/FE's/PSU/Average PSU Evergreen Webinars/PSU Power/PSU Power Slides.pptx")).toMatchObject({ tier: "average", format: "Evergreen Webinar", group: "Resources/Promos/FE's/PSU/Average PSU Evergreen Webinars/PSU Power" });
    expect(parseVaultPromoPath("Resources/Promos/Promo Notes/BE's/DPS.md")).toBeNull();
    expect(parseVaultPromoPath("Resources/Promos/FE's/DPS Launch Webinar Promo Notes.md")).toBeNull();
  });

  it("maps tiers to analyzer fields", () => {
    const winning = promoFieldsFromVault({ funnel: "BE", code: "WAR", tier: "winning", format: "VSL", group: null });
    expect(winning).toMatchObject({ promoType: "Backend VSL", isBestPerformer: true, performanceScore: 9, promoStatus: "Old (Inactive)" });
    expect(promoFieldsFromVault({ funnel: "FE", code: "TPU", tier: "untested", format: "VSL", group: null })).toMatchObject({ promoType: "Front-end", isBestPerformer: false, performanceScore: null, promoStatus: "Draft (Untested)" });
    expect(promoFieldsFromVault({ funnel: "BE", code: "MIC", tier: "under", format: "Live Webinar", group: null }).promoType).toBe("Backend Live Webinar");
  });

  it("cleans titles and spots order forms", () => {
    expect(cleanPromoTitle("TPU Unicorn Promo_LEGAL_provisional final to film.docx")).toBe("TPU Unicorn Promo");
    expect(cleanPromoTitle("PSU Detect CUB_LEGALfinal_RB.LK1_LK3.docx")).toBe("PSU Detect CUB");
    expect(cleanPromoTitle("WAR Overnight TR Edit.LK NA.LK2 NA2._LEGALfinal.docx")).toBe("WAR Overnight TR Edit NA NA2.");
    expect(isOrderForm("Resources/Promos/FE's/TPU/Under Performing TPU VSLs/TPU 4 for _4 OF_LEGALfinal_RB.docx")).toBe(true);
    expect(isOrderForm("Resources/Order Forms/PMK Retail OF.docx")).toBe(true);
    expect(isOrderForm("Resources/Promos/FE's/PSU/Under Performing PSU VSLs/PSU 4 for 4 Order Form_CSLegal1FINAL (1).docx")).toBe(true);
    expect(isOrderForm("Resources/Promos/FE's/TPU/Winning TPU VSLs/TPU Value The Last Great Value Stock.docx")).toBe(false);
    expect(cleanPromoTitle("TPU_OUNCE_LEGALfinal_CB4_RB.LK21.docx")).toBe("TPU OUNCE");
    expect(cleanPromoTitle("TPU Coin Bitcoin to legal_LEGAL_KA 4.LK1.docx")).toBe("TPU Coin Bitcoin");
    expect(cleanPromoTitle("TPU 4 for _4 video script_LEGALfinal_RB.docx")).toBe("TPU 4 for 4 video script");
    expect(codeFromFileName("WAR Evergreen Retail OF_LegalEdits_KB.docx")).toBe("WAR");
  });

  it("reads slide text and notes from a .pptx", () => {
    const slide = (texts: string[]) => `<p:sld><a:p>${texts.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join("")}</a:p><a:p><a:r><a:t>Second &amp; line</a:t></a:r></a:p></p:sld>`;
    const bytes = zipSync({
      "ppt/slides/slide2.xml": strToU8(slide(["Join ", "now"])),
      "ppt/slides/slide1.xml": strToU8(slide(["Welcome"])),
      "ppt/notesSlides/notesSlide1.xml": strToU8("<a:p><a:r><a:t>Say hello</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p>"),
    });
    expect(pptxText(bytes)).toBe("[Slide 1]\nWelcome\nSecond & line\nNotes: Say hello\n\n[Slide 2]\nJoin now\nSecond & line");
    expect(pptxText(new Uint8Array([1, 2, 3]))).toBe("");
  });
});
